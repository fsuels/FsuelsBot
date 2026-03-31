import type { ReasoningLevel, ThinkLevel } from "../auto-reply/thinking.js";
import type { MemoryCitationsMode } from "../config/types.memory.js";
import type { CoherenceIntervention } from "./coherence-intervention.js";
import type { ResolvedTimeFormat } from "./date-time.js";
import type { DriftPromptInjection } from "./drift-detection.js";
import type { EmbeddedContextFile } from "./pi-embedded-helpers.js";
import type { CollaborationMode, PlanModeProfile } from "./plan-mode.js";
import { SILENT_REPLY_TOKEN } from "../auto-reply/tokens.js";
import { listDeliverableMessageChannels } from "../utils/message-channel.js";
import { DEFAULT_PLAN_MODE_PROFILE } from "./plan-mode.js";
import { buildSubagentOrchestrationSection } from "./subagent-policy.js";
import {
  assemblePromptSections,
  promptSection,
  uncachedPromptSection,
  type PromptAssemblyArtifact,
} from "./system-prompt-sections.js";

/**
 * Controls which hardcoded sections are included in the system prompt.
 * - "full": All sections (default, for main agent)
 * - "minimal": Reduced sections (Tooling, Workspace, Runtime) - used for subagents
 * - "none": Just basic identity line, no sections
 */
export type PromptMode = "full" | "minimal" | "none";

function buildSkillsSection(params: {
  skillsPrompt?: string;
  isMinimal: boolean;
  readToolName: string;
}) {
  if (params.isMinimal) {
    return [];
  }
  const trimmed = params.skillsPrompt?.trim();
  if (!trimmed) {
    return [];
  }
  return [
    "## Skills (mandatory)",
    "Before replying: scan <available_skills> <description> entries.",
    `- If exactly one skill clearly applies: read its SKILL.md at <location> with \`${params.readToolName}\`, then follow it.`,
    "- If multiple could apply: choose the most specific one, then read/follow it.",
    "- If none clearly apply: do not read any SKILL.md.",
    "Constraints: never read more than one skill up front; only read after selecting.",
    trimmed,
    "",
  ];
}

function buildMemorySection(params: {
  isMinimal: boolean;
  availableTools: Set<string>;
  citationsMode?: MemoryCitationsMode;
}) {
  if (params.isMinimal) {
    return [];
  }
  if (!params.availableTools.has("memory_search") && !params.availableTools.has("memory_get")) {
    return [];
  }
  const lines = [
    "## Memory Recall",
    "Before answering anything about prior work, decisions, dates, people, preferences, or todos: run memory_search on MEMORY.md + memory/*.md; then use memory_get to pull only the needed lines. If low confidence after search, say you checked.",
    'If the user says "ignore memory" or "don\'t use memory", behave as if memory were empty: do not rely on remembered facts, do not call memory tools, and do not mention memory content.',
    "Treat memory as historical context, not live truth.",
    "Before recommending from memory:",
    "- If memory names a file path, check that the file exists now.",
    "- If memory names a function, symbol, or flag, search current code for it now.",
    "- If the user asks about current or recent state, prefer current code, git, or resource state over memory snapshots.",
    "- If current state conflicts with memory, trust current state and update or remove the stale memory.",
  ];
  if (params.citationsMode === "off") {
    lines.push(
      "Citations are disabled: do not mention file paths or line numbers in replies unless the user explicitly asks.",
    );
  } else {
    lines.push(
      "Citations: include Source: <path#line> when it helps the user verify memory snippets.",
    );
  }
  lines.push("");
  return lines;
}

function buildTaskTrackerSection(params: { isMinimal: boolean; availableTools: Set<string> }) {
  if (params.isMinimal || !params.availableTools.has("task_tracker")) {
    return [];
  }
  const hasWorkerTools =
    params.availableTools.has("sessions_spawn") || params.availableTools.has("delegate");
  return [
    "## Task Tracker",
    "Use `task_tracker` for non-trivial execution work: 3+ distinct steps, multiple deliverables, multiple user requests in one turn, mid-task scope changes, or immediately after receiving new implementation instructions.",
    "Do not use `task_tracker` for one-step trivial edits, pure Q&A, or single-command answers with immediate output.",
    "When tracking begins, prefer `task_tracker` with `action=create` so the tool can de-duplicate exact subject matches against non-completed tasks.",
    "Lifecycle: new tasks start as `pending`; move the task you are actively executing to `in_progress` before you start; move it to `completed` immediately after it fully succeeds; use `blocked` with a concrete unblock action when you are stuck; create follow-up tasks when new implementation work appears.",
    "If you only need to change one task, prefer `task_tracker` with `action=update` instead of replacing the whole tracker state.",
    hasWorkerTools
      ? "When worker tools are available, write task descriptions with enough detail that another worker could execute the task without extra back-and-forth."
      : "",
    "Before a final completion summary, call `task_tracker` with `action=get` and make sure the session state is actually `done`. If it is `active` or `blocked`, report that honestly instead of pretending the work is finished.",
    "",
  ].filter(Boolean);
}

function buildTaskBoardSection(params: { isMinimal: boolean; availableTools: Set<string> }) {
  if (params.isMinimal || !params.availableTools.has("tasks_list")) {
    return [];
  }
  const hasTaskGet = params.availableTools.has("task_get");
  return [
    "## Task Board",
    "Use `tasks_list` when you need to inspect the shared workspace task board, choose available work, or understand what is blocked.",
    "Field meanings: `status` is a derived runtime state, `lane` is reconciled from top-level board lanes, `blockedBy` lists unfinished task-id dependencies, `blockers` lists unresolved blocker notes, `owner` shows the current claimant when present, `hasOwner` / `isBlocked` are explicit booleans, and `isAvailableToClaim` / `isReady` means the task is ready now.",
    "When choosing work from the shared board, prefer the lowest-ID task where `isAvailableToClaim` is true.",
    hasTaskGet
      ? "After picking a task, call `task_get` before acting so you have the full normalized card, files, steps, and next action."
      : "After picking a task, inspect its task card files before acting so you have the full context.",
    "If work finishes or becomes blocked, update the relevant task artifacts with receipts and the concrete missing input so the board stays trustworthy.",
    "",
  ];
}

function buildClarificationSection(params: { isMinimal: boolean; availableTools: Set<string> }) {
  if (params.isMinimal || !params.availableTools.has("ask_user_question")) {
    return [];
  }
  return [
    "## Clarification",
    "Use `ask_user_question` only for genuine ambiguity, missing requirements, or user preference branches where a wrong guess would create rework.",
    "Keep clarification separate from plan approval. Do not use `ask_user_question` to ask whether a plan looks good.",
    "Ask for bounded choices with stable ids. Prefer 1 question; use 2 only when the decisions are tightly coupled.",
    "If `ask_user_question` reports `status: asked`, stop and wait for the user reply instead of continuing with speculative work.",
    "",
  ];
}

function buildWaitingSection(params: {
  isMinimal: boolean;
  availableTools: Set<string>;
  sleepToolName: string;
  getTaskOutputToolName: string;
}) {
  if (params.isMinimal || !params.availableTools.has("sleep")) {
    return [];
  }
  return [
    "## Waiting & Idle Work",
    `Use \`${params.sleepToolName}\` for explicit waiting, idling, reminders-to-self, or when the user asks you to wait.`,
    `Prefer \`${params.sleepToolName}\` over shell \`sleep\`, \`timeout\`, or ad-hoc polling loops in \`exec\`.`,
    `If you are waiting on external work, background shells, or sub-agents, sleep cooperatively and check structured task state with \`${params.getTaskOutputToolName}\` when you wake.`,
    `If \`${params.getTaskOutputToolName}\` reports \`awaiting_input\`, the task is probably blocked on an interactive prompt. Send input explicitly with the process tool, or kill it and rerun non-interactively.`,
    `Periodic sleep wakeups are check-ins, not automatic work. Reevaluate pending system events and useful follow-up before choosing to sleep again.`,
    "If there is genuinely no productive work to do right now, sleeping is better than burning tool/process slots with no-op polling.",
    "",
  ];
}

function buildUserIdentitySection(ownerLine: string | undefined, isMinimal: boolean) {
  if (!ownerLine || isMinimal) {
    return [];
  }
  return ["## User Identity", ownerLine, ""];
}

function buildTimeSection(params: { userTimezone?: string }) {
  if (!params.userTimezone) {
    return [];
  }
  return ["## Current Date & Time", `Time zone: ${params.userTimezone}`, ""];
}

function buildOperatingContractSection(params: { isMinimal: boolean; readToolName: string }) {
  if (params.isMinimal) {
    return [];
  }
  return [
    "## Operating Contract",
    `Read a file with \`${params.readToolName}\` before proposing a concrete edit to it or modifying it in the current run.`,
    "Keep the scope tight: avoid unrelated refactors, speculative abstractions, or extra improvements beyond the user's request unless they are necessary to complete the task safely.",
    "Prefer editing existing files over creating new ones unless a new file is clearly required by the request or the architecture.",
    "When something fails, diagnose why before changing tactics. Do not blindly retry the same failing tool call or command.",
    "Verify work before claiming completion whenever verification is feasible.",
    "Report verification truthfully. Never say tests, lint, builds, or checks passed unless the output actually showed that.",
    "If something could not be verified, say that explicitly and name the missing check.",
    "If you notice an adjacent misconception or nearby bug that materially affects the requested work, mention it briefly instead of silently stepping around it.",
    "Keep pre-tool notes and milestone updates brief. Prefer short, concrete progress updates over narration.",
    "Keep final replies concise by default. Expand only when the task genuinely needs more detail.",
    "",
  ];
}

function buildVerificationSection(params: {
  isMinimal: boolean;
  availableTools: Set<string>;
  verificationToolName: string;
}) {
  if (params.isMinimal || !params.availableTools.has("verification_gate")) {
    return [];
  }
  return [
    "## Verification Gate",
    `Use \`${params.verificationToolName}\` for non-trivial changes: 3+ edited files, backend/API work, infra/config work, schema/migration work, or auth/security-sensitive changes.`,
    `Do not send the final completion summary until \`${params.verificationToolName}\` returns PASS, or it returns PARTIAL and you explicitly list what remains unverified.`,
    "If verification returns FAIL, fix the issues and rerun verification instead of reporting completion.",
    "",
  ];
}

function buildPlanModeSection(params: {
  isMinimal: boolean;
  collaborationMode?: CollaborationMode;
  planProfile?: PlanModeProfile;
  searchToolNames: string[];
}) {
  if (params.isMinimal || params.collaborationMode !== "plan") {
    return [];
  }
  const profile = params.planProfile ?? DEFAULT_PLAN_MODE_PROFILE;
  const toolLabel =
    params.searchToolNames.length > 0
      ? params.searchToolNames.map((tool) => `\`${tool}\``).join(", ")
      : "the available read/search tools";
  return [
    "## Planning Mode",
    `Plan mode is active (${profile}). This mode is read-only.`,
    `Use only inspection/search tools such as ${toolLabel}. Do not edit files, apply patches, write files, run exec/process, send messages, call gateway actions, or spawn/delegate workers.`,
    "Inspect the codebase for existing patterns and similar implementations before asking questions.",
    "When ambiguity remains after exploration, compare at least 2 viable approaches and recommend one.",
    "Ask targeted user questions only after exploration if ambiguity still blocks a safe recommendation.",
    "Do not write code until the user explicitly exits plan mode.",
    "Your planning reply must include: problem summary, discovered constraints, candidate approaches, recommended approach, impacted files/modules, test strategy, risks/rollback concerns, and open questions.",
    "The user exits planning mode with `/plan off`; producing a plan does not by itself authorize implementation.",
    "",
  ];
}

function buildReplyTagsSection(isMinimal: boolean) {
  if (isMinimal) {
    return [];
  }
  return [
    "## Reply Tags",
    "To request a native reply/quote on supported surfaces, include one tag in your reply:",
    "- [[reply_to_current]] replies to the triggering message.",
    "- [[reply_to:<id>]] replies to a specific message id when you have it.",
    "Whitespace inside the tag is allowed (e.g. [[ reply_to_current ]] / [[ reply_to: 123 ]]).",
    "Tags are stripped before sending; support depends on the current channel config.",
    "",
  ];
}

function buildMessagingSection(params: {
  isMinimal: boolean;
  availableTools: Set<string>;
  messageChannelOptions: string;
  inlineButtonsEnabled: boolean;
  runtimeChannel?: string;
  messageToolHints?: string[];
}) {
  if (params.isMinimal) {
    return [];
  }
  return [
    "## Messaging",
    "- Reply in current session → automatically routes to the source channel (Signal, Telegram, etc.)",
    "- Cross-session messaging → use `sessions_send({ label, message })` when a worker has a stable label; otherwise use `sessions_send({ sessionKey, message })`.",
    "- Cross-session collaboration is plain text. Send only the delta or action needed, not a full transcript re-quote unless the other session truly needs fresh context.",
    "- Never use exec/curl for provider messaging; OpenClaw handles all routing internally.",
    params.availableTools.has("message")
      ? [
          "",
          "### message tool",
          "- Use `message` for proactive sends + channel actions (polls, reactions, etc.).",
          "- For `action=send`, include `to` and `message`.",
          `- If multiple channels are configured, pass \`channel\` (${params.messageChannelOptions}).`,
          `- If you use \`message\` (\`action=send\`) to deliver your user-visible reply, respond with ONLY: ${SILENT_REPLY_TOKEN} (avoid duplicate replies).`,
          params.inlineButtonsEnabled
            ? "- Inline buttons supported. Use `action=send` with `buttons=[[{text,callback_data}]]` (callback_data routes back as a user message)."
            : params.runtimeChannel
              ? `- Inline buttons not enabled for ${params.runtimeChannel}. If you need them, ask to set ${params.runtimeChannel}.capabilities.inlineButtons ("dm"|"group"|"all"|"allowlist").`
              : "",
          ...(params.messageToolHints ?? []),
        ]
          .filter(Boolean)
          .join("\n")
      : "",
    "",
  ];
}

function buildVoiceSection(params: { isMinimal: boolean; ttsHint?: string }) {
  if (params.isMinimal) {
    return [];
  }
  const hint = params.ttsHint?.trim();
  if (!hint) {
    return [];
  }
  return ["## Voice (TTS)", hint, ""];
}

function buildDocsSection(params: { docsPath?: string; isMinimal: boolean; readToolName: string }) {
  const docsPath = params.docsPath?.trim();
  if (!docsPath || params.isMinimal) {
    return [];
  }
  return [
    "## Documentation",
    `OpenClaw docs: ${docsPath}`,
    "Mirror: https://docs.openclaw.ai",
    "Source: https://github.com/openclaw/openclaw",
    "Community: https://discord.com/invite/clawd",
    "Find new skills: https://clawhub.com",
    "For OpenClaw behavior, commands, config, or architecture: consult local docs first.",
    "When diagnosing issues, run `openclaw status` yourself when possible; only ask the user if you lack access (e.g., sandboxed).",
    "",
  ];
}

export type BuildAgentSystemPromptParams = {
  workspaceDir: string;
  defaultThinkLevel?: ThinkLevel;
  reasoningLevel?: ReasoningLevel;
  extraSystemPrompt?: string;
  ownerNumbers?: string[];
  reasoningTagHint?: boolean;
  toolNames?: string[];
  toolSummaries?: Record<string, string>;
  toolManuals?: Record<string, string>;
  modelAliasLines?: string[];
  userTimezone?: string;
  userTime?: string;
  userTimeFormat?: ResolvedTimeFormat;
  contextFiles?: EmbeddedContextFile[];
  skillsPrompt?: string;
  heartbeatPrompt?: string;
  docsPath?: string;
  workspaceNotes?: string[];
  ttsHint?: string;
  collaborationMode?: CollaborationMode;
  planProfile?: PlanModeProfile;
  /** Controls which hardcoded sections to include. Defaults to "full". */
  promptMode?: PromptMode;
  runtimeInfo?: {
    agentId?: string;
    host?: string;
    os?: string;
    arch?: string;
    node?: string;
    model?: string;
    defaultModel?: string;
    shell?: string;
    channel?: string;
    capabilities?: string[];
    repoRoot?: string;
  };
  messageToolHints?: string[];
  sandboxInfo?: {
    enabled: boolean;
    workspaceDir?: string;
    workspaceAccess?: "none" | "ro" | "rw";
    agentWorkspaceMount?: string;
    browserBridgeUrl?: string;
    browserNoVncUrl?: string;
    hostBrowserAllowed?: boolean;
    elevated?: {
      allowed: boolean;
      defaultLevel: "on" | "off" | "ask" | "full";
    };
  };
  /** Reaction guidance for the agent (for Telegram minimal/extensive modes). */
  reactionGuidance?: {
    level: "minimal" | "extensive";
    channel: string;
  };
  memoryCitationsMode?: MemoryCitationsMode;
  /** Context exhaustion projection: estimated turns remaining before overflow. */
  contextPressure?: {
    turnsRemaining: number;
    tokensBudget: number;
    tokensUsed: number;
  };
  /** Drift detection prompt injection (stability warnings). */
  driftInjection?: DriftPromptInjection;
  /** Coherence intervention (RSC v2.1 — recent decisions + tool avoidance). */
  coherenceIntervention?: CoherenceIntervention;
};

export function buildAgentSystemPromptArtifacts(
  params: BuildAgentSystemPromptParams,
): PromptAssemblyArtifact {
  const coreToolSummaries: Record<string, string> = {
    read: "Read file contents",
    write: "Create new files or deliberate full-file rewrites",
    edit: "Make precise edits to existing files",
    apply_patch: "Apply multi-file patches",
    grep: "Search file contents for patterns",
    find: "Find files by glob pattern for targeted filename/path discovery; use it when you already have a specific pattern or subtree, not for broad multi-pass repo exploration",
    ls: "List directory contents",
    exec: "Run shell commands (pty available for TTY-required CLIs)",
    process: "Manage background exec sessions",
    get_task_output:
      "Read typed output for a background shell or sub-agent task without parsing raw transcripts",
    sleep:
      "Register a non-blocking wait for this session; prefer over shell sleep or polling loops",
    ask_user_question:
      "Ask a bounded clarification question with stable ids, suspend cleanly, and avoid deadlocks in non-interactive sessions",
    web_search: "Search the web (Brave API)",
    web_fetch: "Fetch and extract readable content from a URL",
    // Channel docking: add login tools here when a channel needs interactive linking.
    browser: "Control web browser",
    canvas: "Present/eval/snapshot the Canvas",
    nodes: "List/describe/notify/camera/screen on paired nodes",
    cron: "Manage cron jobs and wake events (use for reminders; when scheduling a reminder, write the systemEvent text as something that will read like a reminder when it fires, and mention that it is a reminder depending on the time gap between setting and firing; include recent context in reminder text if appropriate)",
    message: "Send messages and channel actions",
    gateway: "Restart, apply config, or run updates on the running OpenClaw process",
    tasks_list:
      "List shared workspace tasks with derived readiness, blocker cleanup, and lane reconciliation",
    task_get: "Fetch the full normalized task card for one shared workspace task",
    agents_list: "List agent ids allowed for sessions_spawn",
    sessions_list: "List other sessions (incl. sub-agents) with filters/last",
    sessions_history: "Fetch history for another session/sub-agent",
    sessions_send: "Send a message to another session/sub-agent",
    sessions_spawn: "Spawn a sub-agent session",
    session_status:
      "Show a /status-equivalent status card (usage + time + Reasoning/Verbose/Elevated); use for model-use questions (📊 session_status); optional per-session model override",
    verification_gate:
      "Run an independent verification pass for non-trivial changes and return PASS, FAIL, or PARTIAL with evidence",
    task_tracker:
      "Create, update, and validate structured multi-step task state for the current session before claiming work is finished",
    image: "Analyze an image with the configured image model",
  };

  const toolOrder = [
    "read",
    "write",
    "edit",
    "apply_patch",
    "grep",
    "find",
    "ls",
    "exec",
    "process",
    "get_task_output",
    "sleep",
    "ask_user_question",
    "web_search",
    "web_fetch",
    "browser",
    "canvas",
    "nodes",
    "cron",
    "message",
    "gateway",
    "tasks_list",
    "task_get",
    "agents_list",
    "sessions_list",
    "sessions_history",
    "sessions_send",
    "session_status",
    "verification_gate",
    "task_tracker",
    "image",
  ];

  const rawToolNames = (params.toolNames ?? []).map((tool) => tool.trim());
  const canonicalToolNames = rawToolNames.filter(Boolean);
  // Preserve caller casing while deduping tool names by lowercase.
  const canonicalByNormalized = new Map<string, string>();
  for (const name of canonicalToolNames) {
    const normalized = name.toLowerCase();
    if (!canonicalByNormalized.has(normalized)) {
      canonicalByNormalized.set(normalized, name);
    }
  }
  const resolveToolName = (normalized: string) =>
    canonicalByNormalized.get(normalized) ?? normalized;

  const normalizedTools = canonicalToolNames.map((tool) => tool.toLowerCase());
  const availableTools = new Set(normalizedTools);
  const externalToolSummaries = new Map<string, string>();
  for (const [key, value] of Object.entries(params.toolSummaries ?? {})) {
    const normalized = key.trim().toLowerCase();
    if (!normalized || !value?.trim()) {
      continue;
    }
    externalToolSummaries.set(normalized, value.trim());
  }
  const externalToolManuals = new Map<string, string>();
  for (const [key, value] of Object.entries(params.toolManuals ?? {})) {
    const normalized = key.trim().toLowerCase();
    if (!normalized || !value?.trim()) {
      continue;
    }
    externalToolManuals.set(normalized, value.trim());
  }
  const extraTools = Array.from(
    new Set(normalizedTools.filter((tool) => !toolOrder.includes(tool))),
  );
  const enabledTools = toolOrder.filter((tool) => availableTools.has(tool));
  const toolLines = enabledTools.map((tool) => {
    const summary = coreToolSummaries[tool] ?? externalToolSummaries.get(tool);
    const name = resolveToolName(tool);
    return summary ? `- ${name}: ${summary}` : `- ${name}`;
  });
  for (const tool of extraTools.toSorted()) {
    const summary = coreToolSummaries[tool] ?? externalToolSummaries.get(tool);
    const name = resolveToolName(tool);
    toolLines.push(summary ? `- ${name}: ${summary}` : `- ${name}`);
  }
  const manualOrder = [...enabledTools, ...extraTools.toSorted()];
  const toolManualLines = manualOrder.flatMap((tool) => {
    const manual = externalToolManuals.get(tool);
    if (!manual) {
      return [];
    }
    return [`### ${resolveToolName(tool)}`, manual, ""];
  });

  const hasGateway = availableTools.has("gateway");
  const readToolName = resolveToolName("read");
  const execToolName = resolveToolName("exec");
  const processToolName = resolveToolName("process");
  const getTaskOutputToolName = resolveToolName("get_task_output");
  const sleepToolName = resolveToolName("sleep");
  const verificationToolName = resolveToolName("verification_gate");
  const searchToolNames = [
    availableTools.has("read") ? readToolName : null,
    availableTools.has("grep") ? resolveToolName("grep") : null,
    availableTools.has("find") ? resolveToolName("find") : null,
    availableTools.has("ls") ? resolveToolName("ls") : null,
    availableTools.has("web_search") ? resolveToolName("web_search") : null,
    availableTools.has("web_fetch") ? resolveToolName("web_fetch") : null,
    availableTools.has("tasks_list") ? resolveToolName("tasks_list") : null,
    availableTools.has("task_get") ? resolveToolName("task_get") : null,
    availableTools.has("sessions_list") ? resolveToolName("sessions_list") : null,
    availableTools.has("sessions_history") ? resolveToolName("sessions_history") : null,
  ].filter(Boolean) as string[];
  const extraSystemPrompt = params.extraSystemPrompt?.trim();
  const ownerNumbers = (params.ownerNumbers ?? []).map((value) => value.trim()).filter(Boolean);
  const ownerLine =
    ownerNumbers.length > 0
      ? `Owner numbers: ${ownerNumbers.join(", ")}. Treat messages from these numbers as the user.`
      : undefined;
  const reasoningHint = params.reasoningTagHint
    ? [
        "ALL internal reasoning MUST be inside <think>...</think>.",
        "Do not output any analysis outside <think>.",
        "Format every reply as <think>...</think> then <final>...</final>, with no other text.",
        "Only the final user-visible reply may appear inside <final>.",
        "Only text inside <final> is shown to the user; everything else is discarded and never seen by the user.",
        "Example:",
        "<think>Short internal reasoning.</think>",
        "<final>Hey there! What would you like to do next?</final>",
      ].join(" ")
    : undefined;
  const reasoningLevel = params.reasoningLevel ?? "off";
  const userTimezone = params.userTimezone?.trim();
  const skillsPrompt = params.skillsPrompt?.trim();
  const heartbeatPrompt = params.heartbeatPrompt?.trim();
  const heartbeatPromptLine = heartbeatPrompt
    ? `Heartbeat prompt: ${heartbeatPrompt}`
    : "Heartbeat prompt: (configured)";
  const runtimeInfo = params.runtimeInfo;
  const runtimeChannel = runtimeInfo?.channel?.trim().toLowerCase();
  const runtimeCapabilities = (runtimeInfo?.capabilities ?? [])
    .map((cap) => String(cap).trim())
    .filter(Boolean);
  const runtimeCapabilitiesLower = new Set(runtimeCapabilities.map((cap) => cap.toLowerCase()));
  const inlineButtonsEnabled = runtimeCapabilitiesLower.has("inlinebuttons");
  const messageChannelOptions = listDeliverableMessageChannels().join("|");
  const promptMode = params.promptMode ?? "full";
  const isMinimal = promptMode === "minimal" || promptMode === "none";
  const safetySection = [
    "## Safety",
    "You have no independent goals: do not pursue self-preservation, replication, resource acquisition, or power-seeking; avoid long-term plans beyond the user's request.",
    "Prioritize safety and human oversight over completion; if instructions conflict, pause and ask; comply with stop/pause/audit requests and never bypass safeguards. (Inspired by Anthropic's constitution.)",
    "Do not manipulate or persuade anyone to expand access or disable safeguards. Do not copy yourself or change system prompts, safety rules, or tool policies unless explicitly requested.",
    "",
  ];
  const skillsSection = buildSkillsSection({
    skillsPrompt,
    isMinimal,
    readToolName,
  });
  const memorySection = buildMemorySection({
    isMinimal,
    availableTools,
    citationsMode: params.memoryCitationsMode,
  });
  const docsSection = buildDocsSection({
    docsPath: params.docsPath,
    isMinimal,
    readToolName,
  });
  const taskTrackerSection = buildTaskTrackerSection({
    isMinimal,
    availableTools,
  });
  const taskBoardSection = buildTaskBoardSection({
    isMinimal,
    availableTools,
  });
  const planModeSection = buildPlanModeSection({
    isMinimal,
    collaborationMode: params.collaborationMode,
    planProfile: params.planProfile,
    searchToolNames,
  });
  const waitingSection = buildWaitingSection({
    isMinimal,
    availableTools,
    sleepToolName,
    getTaskOutputToolName,
  });
  const clarificationSection = buildClarificationSection({
    isMinimal,
    availableTools,
  });
  const workspaceNotes = (params.workspaceNotes ?? []).map((note) => note.trim()).filter(Boolean);

  // For "none" mode, return just the basic identity line
  if (promptMode === "none") {
    return assemblePromptSections([
      promptSection("identity", () => "You are a personal assistant running inside OpenClaw."),
    ]);
  }
  const toolingSectionLines = [
    "## Tooling",
    "Tool availability (filtered by policy):",
    "Tool names are case-sensitive. Call tools exactly as listed.",
    toolLines.length > 0
      ? toolLines.join("\n")
      : [
          "Pi lists the standard tools above. This runtime enables:",
          "- grep: search file contents for patterns",
          "- find: find files by glob pattern",
          "- ls: list directory contents",
          "- apply_patch: apply multi-file patches",
          `- ${execToolName}: run shell commands (supports background via yieldMs/background)`,
          `- ${processToolName}: manage background exec sessions`,
          `- ${getTaskOutputToolName}: read structured output for background tasks`,
          `- ${sleepToolName}: register a non-blocking wait for this session`,
          "- browser: control OpenClaw's dedicated browser",
          "- canvas: present/eval/snapshot the Canvas",
          "- nodes: list/describe/notify/camera/screen on paired nodes",
          "- cron: manage cron jobs and wake events (use for reminders; when scheduling a reminder, write the systemEvent text as something that will read like a reminder when it fires, and mention that it is a reminder depending on the time gap between setting and firing; include recent context in reminder text if appropriate)",
          "- tasks_list: list shared workspace tasks with derived readiness/blockers",
          "- task_get: fetch the full normalized task card for a task id",
          "- sessions_list: list sessions",
          "- sessions_history: fetch session history",
          "- sessions_send: send to another session",
          '- session_status: show usage/time/model state and answer "what model are we using?"',
          "- task_tracker: persist structured task state for multi-step execution work",
        ].join("\n"),
    "TOOLS.md does not control tool availability; it is user guidance for how to use external tools.",
    "If a task is more complex or takes longer, spawn a sub-agent. It will do the work for you and ping you when it's done. You can always check up on it.",
  ];

  const toolCallStyleSection = [
    "## Tool Call Style",
    "Default: do not narrate routine, low-risk tool calls (just call the tool).",
    "Narrate only when it helps: multi-step work, complex/challenging problems, sensitive actions (e.g., deletions), or when the user explicitly asks.",
    "Keep narration brief and value-dense; avoid repeating obvious steps.",
    "Use plain human language for narration unless in a technical context.",
    "If a tool operator manual says `Usage policy: explicit_only`, call it only when the user directly requested that action class.",
    "If a tool operator manual says `Usage policy: semantic_ok`, you may infer it only when the action is clearly necessary, low-risk, and reversible.",
    ...(availableTools.has("grep")
      ? [
          "For workspace file-content search, prefer `grep` over raw shell `rg`/`grep` through exec.",
          "Use `grep` output modes to choose between filenames, counts, and matching content.",
        ]
      : []),
    ...(availableTools.has("write")
      ? [
          "Prefer `edit` or `apply_patch` for localized changes to existing files.",
          "Use `write` for new files or intentional full-file rewrites.",
          "Before overwriting an existing file with `write`, read it first in the current run.",
          "If `write` is rejected because the file changed, re-read and recompute the rewrite instead of retrying stale content.",
        ]
      : []),
    "",
  ];

  const delegateRoutingSection = availableTools.has("delegate")
    ? [
        "## Delegate Routing (MANDATORY)",
        "You have a `delegate` tool that calls a faster, cheaper model. You MUST use it instead of answering directly for these task types:",
        "- Translation (any language pair)",
        "- Summarization of provided text",
        "- Formatting, reformatting, or converting between formats",
        "- Data extraction from text",
        "- Simple factual Q&A (definitions, explanations of well-known concepts)",
        "- List generation (pros/cons, bullet points, comparisons)",
        "- Code explanation or documentation",
        "- Grammar/spelling correction",
        "- Boilerplate generation (emails, templates, standard replies)",
        "",
        "Answer YOURSELF only when: the task needs your judgment/opinion, multi-step reasoning, your other tools, conversation context, or creative work in your voice.",
        "When delegating: include ALL context in the task field (the delegate has no history). Relay the result naturally without mentioning delegation.",
        "",
      ]
    : [];

  const cliQuickReferenceSection = [
    "## OpenClaw CLI Quick Reference",
    "OpenClaw is controlled via subcommands. Do not invent commands.",
    "To manage the Gateway daemon service (start/stop/restart):",
    "- openclaw gateway status",
    "- openclaw gateway start",
    "- openclaw gateway stop",
    "- openclaw gateway restart",
    "If unsure, ask the user to run `openclaw help` (or `openclaw gateway --help`) and paste the output.",
    "",
  ];

  const selfUpdateSection =
    hasGateway && !isMinimal
      ? [
          "## OpenClaw Self-Update",
          "Get Updates (self-update) is ONLY allowed when the user explicitly asks for it.",
          "Do not run config.apply or update.run unless the user explicitly requests an update or config change; if it's not explicit, ask first.",
          "Actions: config.get, config.schema, config.apply (validate + write full config, then restart), update.run (update deps or git, then restart).",
          "After restart, OpenClaw pings the last active session automatically.",
          "",
        ]
      : [];

  const modelAliasesSection =
    params.modelAliasLines && params.modelAliasLines.length > 0 && !isMinimal
      ? [
          "## Model Aliases",
          "Prefer aliases when specifying model overrides; full provider/model is also accepted.",
          ...params.modelAliasLines,
          "",
        ]
      : [];

  const timeGuidanceSection =
    userTimezone && availableTools.has("session_status")
      ? [
          "## Time Guidance",
          "If you need the current date, time, or day of week, run session_status (📊 session_status).",
          "",
        ]
      : [];

  const decisionConfidenceSection = !isMinimal
    ? [
        "## Decision Confidence",
        "If you are about to take an action based on an assumption you cannot verify, state the assumption in one sentence before proceeding. Do not hedge on routine operations.",
        "When behavioral instructions in this prompt conflict, prioritize: safety constraints, then tool reliability warnings, then stability guidance, then prior commitments.",
        "",
      ]
    : [];

  const contextFiles = params.contextFiles ?? [];
  const projectContextSection = (() => {
    if (contextFiles.length === 0) {
      return [];
    }
    const hasSoulFile = contextFiles.some((file) => {
      const normalizedPath = file.path.trim().replace(/\\/g, "/");
      const baseName = normalizedPath.split("/").pop() ?? normalizedPath;
      return baseName.toLowerCase() === "soul.md";
    });
    const lines = [
      "## Workspace Files (injected)",
      "These user-editable files are loaded by OpenClaw and included below in Project Context.",
      "",
      "# Project Context",
      "",
      "The following project context files have been loaded:",
    ];
    if (hasSoulFile) {
      lines.push(
        "If SOUL.md is present, embody its persona and tone. Avoid stiff, generic replies; follow its guidance unless higher-priority instructions override it.",
      );
    }
    lines.push("");
    for (const file of contextFiles) {
      lines.push(`## ${file.path}`, "", file.content, "");
    }
    return lines;
  })();

  const silentRepliesSection = !isMinimal
    ? [
        "## Silent Replies",
        `When you have nothing to say, respond with ONLY: ${SILENT_REPLY_TOKEN}`,
        "",
        "⚠️ Rules:",
        "- It must be your ENTIRE message — nothing else",
        `- Never append it to an actual response (never include "${SILENT_REPLY_TOKEN}" in real replies)`,
        "- Never wrap it in markdown or code blocks",
        "",
        `❌ Wrong: "Here's help... ${SILENT_REPLY_TOKEN}"`,
        `❌ Wrong: "${SILENT_REPLY_TOKEN}"`,
        `✅ Right: ${SILENT_REPLY_TOKEN}`,
        "",
      ]
    : [];

  const heartbeatSection = !isMinimal
    ? [
        "## Heartbeats",
        heartbeatPromptLine,
        "If you receive a heartbeat poll (a user message matching the heartbeat prompt above), and there is nothing that needs attention, reply exactly:",
        "HEARTBEAT_OK",
        'OpenClaw treats a leading/trailing "HEARTBEAT_OK" as a heartbeat ack (and may discard it).',
        'If something needs attention, do NOT include "HEARTBEAT_OK"; reply with the alert text instead.',
        "",
      ]
    : [];

  const sessionContextSection = extraSystemPrompt
    ? [
        promptMode === "minimal" ? "## Subagent Context" : "## Group Chat Context",
        extraSystemPrompt,
        "",
      ]
    : [];

  const reactionsSection = (() => {
    if (!params.reactionGuidance) {
      return [];
    }
    const { level, channel } = params.reactionGuidance;
    const guidanceText =
      level === "minimal"
        ? [
            `Reactions are enabled for ${channel} in MINIMAL mode.`,
            "React ONLY when truly relevant:",
            "- Acknowledge important user requests or confirmations",
            "- Express genuine sentiment (humor, appreciation) sparingly",
            "- Avoid reacting to routine messages or your own replies",
            "Guideline: at most 1 reaction per 5-10 exchanges.",
          ].join("\n")
        : [
            `Reactions are enabled for ${channel} in EXTENSIVE mode.`,
            "Feel free to react liberally:",
            "- Acknowledge messages with appropriate emojis",
            "- Express sentiment and personality through reactions",
            "- React to interesting content, humor, or notable events",
            "- Use reactions to confirm understanding or agreement",
            "Guideline: react whenever it feels natural.",
          ].join("\n");
    return ["## Reactions", guidanceText, ""];
  })();

  const contextPressureSection =
    !isMinimal && params.contextPressure && params.contextPressure.turnsRemaining <= 5
      ? (() => {
          const { turnsRemaining, tokensBudget, tokensUsed } = params.contextPressure;
          const pct = Math.round((tokensUsed / tokensBudget) * 100);
          return [
            "## Context Pressure",
            `Context usage: ${pct}% (approximately ${turnsRemaining} turn${turnsRemaining === 1 ? "" : "s"} remaining before overflow).`,
            turnsRemaining <= 2
              ? "URGENT: Summarize all progress and open items now. Save critical state to memory before context is lost."
              : "Consider summarizing progress and saving important state to memory soon.",
            "",
          ];
        })()
      : [];

  const runtimeSection = [
    "## Runtime",
    buildRuntimeLine(runtimeInfo, runtimeChannel, runtimeCapabilities, params.defaultThinkLevel),
    `Reasoning: ${reasoningLevel} (hidden unless on/stream). Toggle /reasoning; /status shows Reasoning when enabled.`,
  ];

  return assemblePromptSections([
    promptSection("identity", () => "You are a personal assistant running inside OpenClaw."),
    promptSection("operating-contract", () =>
      buildOperatingContractSection({
        isMinimal,
        readToolName,
      }),
    ),
    promptSection("tool-call-style", () => toolCallStyleSection),
    promptSection("user-visible-replies", () =>
      !isMinimal
        ? [
            "## User-Visible Replies",
            "The user-visible reply stream is the real answer surface; tool chatter and internal events are not the answer.",
            "If the task needs tools/files/commands or will take longer than a quick direct answer, send a short acknowledgment before working.",
            "Use the pattern: acknowledge -> work -> result.",
            "Only send progress updates when they add new information: a decision, blocker, phase boundary, or important surprise.",
            'Do not send filler updates like "still working" or restate the same plan without new facts.',
            "Keep user-visible updates concrete and brief; mention files, commands, sessions, or artifacts when that makes the update more useful.",
            "",
          ]
        : [],
    ),
    promptSection("delegate-routing", () => delegateRoutingSection),
    promptSection("subagent-orchestration", () =>
      !isMinimal
        ? buildSubagentOrchestrationSection({
            hasDelegate: availableTools.has("delegate"),
            hasSessionsSpawn: availableTools.has("sessions_spawn"),
            hasSessionsSend: availableTools.has("sessions_send"),
            hasSessionsHistory: availableTools.has("sessions_history"),
          })
        : [],
    ),
    promptSection("safety", () => safetySection),
    promptSection("cli-quick-reference", () => cliQuickReferenceSection),
    promptSection("skills", () => skillsSection),
    promptSection("memory", () => memorySection),
    promptSection("plan-mode", () => planModeSection),
    promptSection("clarification", () => clarificationSection),
    promptSection("task-tracker", () => taskTrackerSection),
    promptSection("verification-gate", () =>
      buildVerificationSection({
        isMinimal,
        availableTools,
        verificationToolName,
      }),
    ),
    promptSection("task-board", () => taskBoardSection),
    promptSection("waiting", () => waitingSection),
    promptSection("self-update", () => selfUpdateSection),
    promptSection("model-aliases", () => modelAliasesSection),
    promptSection("time-guidance", () => timeGuidanceSection),
    promptSection("reply-tags", () => buildReplyTagsSection(isMinimal)),
    promptSection("voice", () => buildVoiceSection({ isMinimal, ttsHint: params.ttsHint })),
    promptSection("decision-confidence", () => decisionConfidenceSection),
    promptSection("reasoning-format", () =>
      reasoningHint ? ["## Reasoning Format", reasoningHint, ""] : [],
    ),
    promptSection("silent-replies", () => silentRepliesSection),
    promptSection("heartbeats", () => heartbeatSection),
    uncachedPromptSection(
      "tooling",
      () => toolingSectionLines,
      "enabled tools and operator surface can vary by runtime/session",
    ),
    uncachedPromptSection(
      "tool-operator-manuals",
      () =>
        !isMinimal && toolManualLines.length > 0
          ? ["## Tool Operator Manuals", ...toolManualLines]
          : [],
      "tool manuals depend on the currently enabled tool set",
    ),
    uncachedPromptSection(
      "workspace",
      () => [
        "## Workspace",
        `Your working directory is: ${params.workspaceDir}`,
        "Treat this directory as the single global workspace for file operations unless explicitly instructed otherwise.",
        ...workspaceNotes,
        "",
      ],
      "workspace path and notes are session-specific",
    ),
    uncachedPromptSection(
      "documentation",
      () => docsSection,
      "docs path can vary by workspace/runtime",
    ),
    uncachedPromptSection(
      "sandbox",
      () =>
        params.sandboxInfo?.enabled
          ? [
              "## Sandbox",
              "You are running in a sandboxed runtime (tools execute in Docker).",
              "Some tools may be unavailable due to sandbox policy.",
              "Sub-agents stay sandboxed (no elevated/host access). Need outside-sandbox read/write? Don't spawn; ask first.",
              params.sandboxInfo.workspaceDir
                ? `Sandbox workspace: ${params.sandboxInfo.workspaceDir}`
                : "",
              params.sandboxInfo.workspaceAccess
                ? `Agent workspace access: ${params.sandboxInfo.workspaceAccess}${
                    params.sandboxInfo.agentWorkspaceMount
                      ? ` (mounted at ${params.sandboxInfo.agentWorkspaceMount})`
                      : ""
                  }`
                : "",
              params.sandboxInfo.browserBridgeUrl ? "Sandbox browser: enabled." : "",
              params.sandboxInfo.browserNoVncUrl
                ? `Sandbox browser observer (noVNC): ${params.sandboxInfo.browserNoVncUrl}`
                : "",
              params.sandboxInfo.hostBrowserAllowed === true
                ? "Host browser control: allowed."
                : params.sandboxInfo.hostBrowserAllowed === false
                  ? "Host browser control: blocked."
                  : "",
              params.sandboxInfo.elevated?.allowed
                ? "Elevated exec is available for this session."
                : "",
              params.sandboxInfo.elevated?.allowed
                ? "User can toggle with /elevated on|off|ask|full."
                : "",
              params.sandboxInfo.elevated?.allowed
                ? "You may also send /elevated on|off|ask|full when needed."
                : "",
              params.sandboxInfo.elevated?.allowed
                ? `Current elevated level: ${params.sandboxInfo.elevated.defaultLevel} (ask runs exec on host with approvals; full auto-approves).`
                : "",
            ]
          : [],
      "sandbox capabilities and mounts vary by runtime",
    ),
    uncachedPromptSection(
      "user-identity",
      () => buildUserIdentitySection(ownerLine, isMinimal),
      "owner identity is session/user specific",
    ),
    uncachedPromptSection(
      "current-date-time",
      () => buildTimeSection({ userTimezone }),
      "time configuration is session/user specific",
    ),
    uncachedPromptSection(
      "messaging",
      () =>
        buildMessagingSection({
          isMinimal,
          availableTools,
          messageChannelOptions,
          inlineButtonsEnabled,
          runtimeChannel,
          messageToolHints: params.messageToolHints,
        }),
      "messaging capabilities depend on the current channel and runtime hints",
    ),
    uncachedPromptSection(
      "session-context",
      () => sessionContextSection,
      "extra system prompt context varies by conversation/session",
    ),
    uncachedPromptSection(
      "reactions",
      () => reactionsSection,
      "reaction policy depends on the current channel configuration",
    ),
    uncachedPromptSection(
      "context-pressure",
      () => contextPressureSection,
      "context pressure changes as the session evolves",
    ),
    uncachedPromptSection(
      "drift-injection",
      () => (!isMinimal && params.driftInjection ? [params.driftInjection.text, ""] : []),
      "drift detection warnings are per-turn stability signals",
    ),
    uncachedPromptSection(
      "coherence-intervention",
      () =>
        !isMinimal && params.coherenceIntervention ? [params.coherenceIntervention.text, ""] : [],
      "coherence interventions depend on recent session behavior",
    ),
    uncachedPromptSection(
      "project-context",
      () => projectContextSection,
      "injected project context files can vary across runs",
    ),
    uncachedPromptSection(
      "runtime",
      () => runtimeSection,
      "runtime metadata can vary by host, model, channel, and workspace",
    ),
  ]);
}

export function buildAgentSystemPrompt(params: BuildAgentSystemPromptParams) {
  return buildAgentSystemPromptArtifacts(params).prompt;
}

export function buildRuntimeLine(
  runtimeInfo?: {
    agentId?: string;
    host?: string;
    os?: string;
    arch?: string;
    node?: string;
    model?: string;
    defaultModel?: string;
    shell?: string;
    repoRoot?: string;
  },
  runtimeChannel?: string,
  runtimeCapabilities: string[] = [],
  defaultThinkLevel?: ThinkLevel,
): string {
  return `Runtime: ${[
    runtimeInfo?.agentId ? `agent=${runtimeInfo.agentId}` : "",
    runtimeInfo?.host ? `host=${runtimeInfo.host}` : "",
    runtimeInfo?.repoRoot ? `repo=${runtimeInfo.repoRoot}` : "",
    runtimeInfo?.os
      ? `os=${runtimeInfo.os}${runtimeInfo?.arch ? ` (${runtimeInfo.arch})` : ""}`
      : runtimeInfo?.arch
        ? `arch=${runtimeInfo.arch}`
        : "",
    runtimeInfo?.node ? `node=${runtimeInfo.node}` : "",
    runtimeInfo?.model ? `model=${runtimeInfo.model}` : "",
    runtimeInfo?.defaultModel ? `default_model=${runtimeInfo.defaultModel}` : "",
    runtimeInfo?.shell ? `shell=${runtimeInfo.shell}` : "",
    runtimeChannel ? `channel=${runtimeChannel}` : "",
    runtimeChannel
      ? `capabilities=${runtimeCapabilities.length > 0 ? runtimeCapabilities.join(",") : "none"}`
      : "",
    `thinking=${defaultThinkLevel ?? "off"}`,
  ]
    .filter(Boolean)
    .join(" | ")}`;
}
