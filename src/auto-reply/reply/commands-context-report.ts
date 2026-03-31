import { SessionManager } from "@mariozechner/pi-coding-agent";
import type { SessionSystemPromptReport } from "../../config/sessions/types.js";
import type { ReplyPayload } from "../types.js";
import type { HandleCommandsParams } from "./commands-types.js";
import { resolveSessionAgentIds } from "../../agents/agent-scope.js";
import { resolveBootstrapContextForRun } from "../../agents/bootstrap-files.js";
import { resolveDefaultModelForAgent } from "../../agents/model-selection.js";
import {
  attachModelViewToSystemPromptReport,
  estimateTokensFromChars,
  projectConversationForModel,
} from "../../agents/model-visible-context.js";
import { resolveBootstrapMaxChars } from "../../agents/pi-embedded-helpers.js";
import { createOpenClawCodingTools } from "../../agents/pi-tools.js";
import { resolveSandboxRuntimeStatus } from "../../agents/sandbox.js";
import { buildWorkspaceSkillSnapshot } from "../../agents/skills.js";
import { getSkillsSnapshotVersion } from "../../agents/skills/refresh.js";
import { buildSystemPromptParams } from "../../agents/system-prompt-params.js";
import { buildSystemPromptReport } from "../../agents/system-prompt-report.js";
import { buildAgentSystemPromptArtifacts } from "../../agents/system-prompt.js";
import { buildToolOperatorManualMap, buildToolSummaryMap } from "../../agents/tool-summaries.js";
import { resolveSessionFilePath } from "../../config/sessions.js";
import { getRemoteSkillEligibility } from "../../infra/skills-remote.js";
import { resolveSessionTaskId } from "../../sessions/task-context.js";
import { buildTtsSystemPromptHint } from "../../tts/tts.js";

function formatInt(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

function formatCharsAndTokens(chars: number): string {
  return `${formatInt(chars)} chars (~${formatInt(estimateTokensFromChars(chars))} tok)`;
}

function formatTokenCount(tokens: number): string {
  return `${formatInt(tokens)} tok`;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function parseContextArgs(commandBodyNormalized: string): string {
  if (commandBodyNormalized === "/context") {
    return "";
  }
  if (commandBodyNormalized.startsWith("/context ")) {
    return commandBodyNormalized.slice(8).trim();
  }
  return "";
}

function formatListTop(
  entries: Array<{ name: string; value: number }>,
  cap: number,
): { lines: string[]; omitted: number } {
  const sorted = [...entries].toSorted((a, b) => b.value - a.value);
  const top = sorted.slice(0, cap);
  const omitted = Math.max(0, sorted.length - top.length);
  const lines = top.map((e) => `- ${e.name}: ${formatCharsAndTokens(e.value)}`);
  return { lines, omitted };
}

type ContextSuggestionSeverity = "info" | "warn" | "critical";

type ContextSuggestion = {
  severity: ContextSuggestionSeverity;
  title: string;
  detail: string;
  estimatedTokenSavings: number;
};

type ContextSourceGroup =
  | "project"
  | "user"
  | "managed"
  | "plugin"
  | "built-in"
  | "extra"
  | "unknown";

type ContextSourceContributor = {
  name: string;
  tokens: number;
  detail?: string;
};

type ContextSourceSummary = {
  source: ContextSourceGroup;
  totalTokens: number;
  contributors: ContextSourceContributor[];
};

type ContextInspectorData = {
  totalTokens: number;
  maxTokens?: number;
  percentUsed?: number;
  freeTokens?: number;
  categoryBreakdown: Array<{ key: string; label: string; tokens: number; share?: number }>;
  sourceBreakdown: ContextSourceSummary[];
  rewrites: Array<{
    key: string;
    label: string;
    messages: number;
    tokens: number;
    changed: boolean;
    savingsTokens: number;
    reason?: string;
  }>;
  status: {
    taskScoped: boolean;
    dmHistoryLimit?: number;
    truncatedToolResults: number;
    compactionCount: number;
    activeRewrites: string[];
  };
  files: {
    totalInjectedTokens: number;
    memoryFiles: Array<{ name: string; tokens: number; synthetic: boolean; truncated: boolean }>;
  };
  skills: {
    availableCount: number;
    loadedCount: number;
    promptTokens: number;
    sourceBreakdown: Array<{ source: string; count: number; tokens: number; names: string[] }>;
  };
  tools: {
    loadedCount: number;
    listTokens: number;
    schemaTokens: number;
    names: string[];
  };
  suggestions: ContextSuggestion[];
};

function normalizeSkillSourceGroup(
  sourceCategory?: SessionSystemPromptReport["skills"]["entries"][number]["sourceCategory"],
): ContextSourceGroup {
  switch (sourceCategory) {
    case "workspace":
      return "project";
    case "managed":
      return "managed";
    case "plugin":
      return "plugin";
    case "bundled":
      return "built-in";
    case "extra":
      return "extra";
    default:
      return "unknown";
  }
}

function pushSourceContributor(
  groups: Map<ContextSourceGroup, ContextSourceContributor[]>,
  source: ContextSourceGroup,
  contributor: ContextSourceContributor,
) {
  const existing = groups.get(source) ?? [];
  existing.push(contributor);
  groups.set(source, existing);
}

function buildContextInspectorData(params: {
  report: SessionSystemPromptReport;
  session: { contextTokens: number | null };
  sessionEntry?: HandleCommandsParams["sessionEntry"];
}): ContextInspectorData {
  const { report } = params;
  const systemPromptTokens =
    report.modelView?.systemPromptTokens ?? estimateTokensFromChars(report.systemPrompt.chars);
  const toolSchemaTokens =
    report.modelView?.toolSchemaTokens ?? estimateTokensFromChars(report.tools.schemaChars);
  const projectedHistoryTokens = report.modelView?.projectedHistoryTokens ?? 0;
  const totalTokens =
    report.modelView?.projectedTotalTokens ??
    systemPromptTokens + toolSchemaTokens + projectedHistoryTokens;
  const maxTokens =
    report.modelView?.contextWindowTokens ??
    (typeof params.session.contextTokens === "number" && params.session.contextTokens > 0
      ? params.session.contextTokens
      : undefined);
  const percentUsed = maxTokens && maxTokens > 0 ? Math.min(1, totalTokens / maxTokens) : undefined;
  const freeTokens = maxTokens ? Math.max(0, maxTokens - totalTokens) : undefined;

  const projectContextTokens = Math.min(
    systemPromptTokens,
    estimateTokensFromChars(report.systemPrompt.projectContextChars),
  );
  const nonProjectPromptTokens = Math.max(0, systemPromptTokens - projectContextTokens);
  const listTokens = estimateTokensFromChars(report.tools.listChars);
  const skillPromptTokens = estimateTokensFromChars(report.skills.promptChars);

  const fileEntries = report.injectedWorkspaceFiles.map((file) => ({
    ...file,
    tokens: estimateTokensFromChars(file.injectedChars),
  }));
  const totalInjectedTokens = fileEntries.reduce((sum, file) => sum + file.tokens, 0);
  const projectContextWrapperTokens = Math.max(0, projectContextTokens - totalInjectedTokens);
  const skillEntryTokens = report.skills.entries.reduce(
    (sum, entry) => sum + estimateTokensFromChars(entry.blockChars),
    0,
  );
  const corePromptTokens = Math.max(0, nonProjectPromptTokens - listTokens - skillEntryTokens);

  const categoryBreakdown = [
    { key: "project_context", label: "Project context", tokens: projectContextTokens },
    { key: "non_project_prompt", label: "Non-project prompt", tokens: nonProjectPromptTokens },
    { key: "tool_schemas", label: "Tool schemas", tokens: toolSchemaTokens },
    { key: "model_history", label: "Model-visible history", tokens: projectedHistoryTokens },
  ]
    .filter((entry) => entry.tokens > 0)
    .map((entry) => ({
      ...entry,
      share: totalTokens > 0 ? entry.tokens / totalTokens : undefined,
    }));

  const sourceGroups = new Map<ContextSourceGroup, ContextSourceContributor[]>();
  for (const file of fileEntries) {
    pushSourceContributor(sourceGroups, file.sourceGroup ?? "unknown", {
      name: file.name,
      tokens: file.tokens,
      detail: [
        file.synthetic ? "synthetic" : null,
        file.truncated ? "truncated" : null,
        file.missing ? "missing" : null,
      ]
        .filter(Boolean)
        .join(", "),
    });
  }
  for (const skill of report.skills.entries) {
    pushSourceContributor(sourceGroups, normalizeSkillSourceGroup(skill.sourceCategory), {
      name: `skill:${skill.name}`,
      tokens: estimateTokensFromChars(skill.blockChars),
    });
  }
  if (projectedHistoryTokens > 0) {
    pushSourceContributor(sourceGroups, "managed", {
      name: "model-visible history",
      tokens: projectedHistoryTokens,
      detail: "post-rewrite transcript",
    });
  }
  if (projectContextWrapperTokens > 0) {
    pushSourceContributor(sourceGroups, "built-in", {
      name: "project context wrapper",
      tokens: projectContextWrapperTokens,
    });
  }
  if (listTokens > 0) {
    pushSourceContributor(sourceGroups, "built-in", {
      name: "tool list guidance",
      tokens: listTokens,
    });
  }
  if (corePromptTokens > 0) {
    pushSourceContributor(sourceGroups, "built-in", {
      name: "core system prompt",
      tokens: corePromptTokens,
    });
  }
  if (toolSchemaTokens > 0) {
    pushSourceContributor(sourceGroups, "built-in", {
      name: "tool schemas",
      tokens: toolSchemaTokens,
    });
  }

  const sourceBreakdown = [...sourceGroups.entries()]
    .map(([source, contributors]) => {
      const sorted = contributors.toSorted(
        (a, b) => b.tokens - a.tokens || a.name.localeCompare(b.name),
      );
      return {
        source,
        totalTokens: sorted.reduce((sum, contributor) => sum + contributor.tokens, 0),
        contributors: sorted,
      };
    })
    .toSorted((a, b) => b.totalTokens - a.totalTokens || a.source.localeCompare(b.source));

  const skillSourceBreakdown = [
    ...new Map(
      report.skills.entries.map((entry) => [
        entry.sourceCategory ?? "unknown",
        {
          source: entry.sourceCategory ?? "unknown",
          count: 0,
          tokens: 0,
          names: [] as string[],
        },
      ]),
    ).values(),
  ];
  for (const entry of report.skills.entries) {
    const key = entry.sourceCategory ?? "unknown";
    const bucket = skillSourceBreakdown.find((candidate) => candidate.source === key);
    if (!bucket) {
      continue;
    }
    bucket.count += 1;
    bucket.tokens += estimateTokensFromChars(entry.blockChars);
    bucket.names.push(entry.name);
  }
  skillSourceBreakdown.sort((a, b) => b.tokens - a.tokens || a.source.localeCompare(b.source));

  const rewrites =
    report.modelView?.historyStages?.map((stage) => ({
      key: stage.key,
      label: stage.label,
      messages: stage.messages,
      tokens: stage.tokens,
      changed: stage.changed,
      savingsTokens: stage.savingsTokens,
      reason: stage.reason,
    })) ?? [];
  const activeRewrites = rewrites.filter((stage) => stage.changed).map((stage) => stage.label);

  const suggestions: ContextSuggestion[] = [];
  if (typeof percentUsed === "number" && maxTokens && maxTokens > 0 && percentUsed >= 0.8) {
    const target = Math.floor(maxTokens * 0.7);
    suggestions.push({
      severity: percentUsed >= 0.92 ? "critical" : "warn",
      title: "Context window is tight",
      detail: `Only ${formatTokenCount(freeTokens ?? 0)} remain in the model-visible payload. Compact soon or trim prompt overhead before a large turn.`,
      estimatedTokenSavings: Math.max(0, totalTokens - target),
    });
  }
  if (toolSchemaTokens >= 400) {
    suggestions.push({
      severity: toolSchemaTokens >= 1200 ? "warn" : "info",
      title: "Tool schemas are consuming context",
      detail: `${report.tools.entries.length} loaded tools contribute ${formatTokenCount(toolSchemaTokens)} before conversation history. Tighten tool policies for this agent/session if the surface is broader than needed.`,
      estimatedTokenSavings: toolSchemaTokens,
    });
  }
  if (skillPromptTokens >= 250 && report.skills.entries.length > 0) {
    suggestions.push({
      severity: skillPromptTokens >= 800 ? "warn" : "info",
      title: "Skills prompt is sizable",
      detail: `${report.skills.loadedCount ?? report.skills.entries.length} prompt-visible skills consume ${formatTokenCount(skillPromptTokens)}. Narrow skill filters if this session only needs a smaller subset.`,
      estimatedTokenSavings: skillPromptTokens,
    });
  }
  if (totalInjectedTokens >= 250 && fileEntries.length > 0) {
    const heaviest = fileEntries
      .toSorted((a, b) => b.tokens - a.tokens || a.name.localeCompare(b.name))
      .slice(0, 3)
      .map((file) => file.name)
      .join(", ");
    suggestions.push({
      severity: totalInjectedTokens >= 1000 ? "warn" : "info",
      title: "Injected project context is heavy",
      detail: `Injected files contribute ${formatTokenCount(totalInjectedTokens)} (${heaviest || "no named files"}). Trim large bootstrap files or move volatile detail into task-specific context.`,
      estimatedTokenSavings: totalInjectedTokens,
    });
  }
  if ((report.modelView?.truncatedToolResults ?? 0) > 0) {
    const limitedHistoryTokens = report.modelView?.limitedHistoryTokens ?? projectedHistoryTokens;
    suggestions.push({
      severity: "warn",
      title: "Oversized tool results were truncated",
      detail: `${report.modelView?.truncatedToolResults ?? 0} tool result(s) were shortened before the model call. Prefer narrower reads/searches so important details stay intact.`,
      estimatedTokenSavings: Math.max(0, limitedHistoryTokens - projectedHistoryTokens),
    });
  }

  return {
    totalTokens,
    maxTokens,
    percentUsed,
    freeTokens,
    categoryBreakdown,
    sourceBreakdown,
    rewrites,
    status: {
      taskScoped: report.modelView?.taskScoped ?? false,
      dmHistoryLimit: report.modelView?.dmHistoryLimit,
      truncatedToolResults: report.modelView?.truncatedToolResults ?? 0,
      compactionCount: params.sessionEntry?.compactionCount ?? 0,
      activeRewrites,
    },
    files: {
      totalInjectedTokens,
      memoryFiles: fileEntries
        .filter((file) => /^memory(?:\.md)?$/i.test(file.name))
        .map((file) => ({
          name: file.name,
          tokens: file.tokens,
          synthetic: Boolean(file.synthetic),
          truncated: file.truncated,
        })),
    },
    skills: {
      availableCount: report.skills.availableCount ?? report.skills.entries.length,
      loadedCount: report.skills.loadedCount ?? report.skills.entries.length,
      promptTokens: skillPromptTokens,
      sourceBreakdown: skillSourceBreakdown,
    },
    tools: {
      loadedCount: report.tools.entries.length,
      listTokens,
      schemaTokens: toolSchemaTokens,
      names: report.tools.entries.map((entry) => entry.name),
    },
    suggestions: suggestions.toSorted(
      (a, b) => b.estimatedTokenSavings - a.estimatedTokenSavings || a.title.localeCompare(b.title),
    ),
  };
}

export async function loadContextReport(
  params: HandleCommandsParams,
): Promise<SessionSystemPromptReport> {
  const existing = params.sessionEntry?.systemPromptReport;
  if (existing && existing.source === "run") {
    return existing;
  }

  const workspaceDir = params.workspaceDir;
  const bootstrapMaxChars = resolveBootstrapMaxChars(params.cfg, params.provider);
  const { bootstrapFiles, contextFiles: injectedFiles } = await resolveBootstrapContextForRun({
    workspaceDir,
    config: params.cfg,
    sessionKey: params.sessionKey,
    sessionId: params.sessionEntry?.sessionId,
    provider: params.provider,
  });
  const skillsSnapshot = (() => {
    try {
      return buildWorkspaceSkillSnapshot(workspaceDir, {
        config: params.cfg,
        eligibility: { remote: getRemoteSkillEligibility() },
        snapshotVersion: getSkillsSnapshotVersion(workspaceDir),
      });
    } catch {
      return { prompt: "", skills: [], resolvedSkills: [] };
    }
  })();
  const skillsPrompt = skillsSnapshot.prompt ?? "";
  const sandboxRuntime = resolveSandboxRuntimeStatus({
    cfg: params.cfg,
    sessionKey: params.ctx.SessionKey ?? params.sessionKey,
  });
  const tools = (() => {
    try {
      return createOpenClawCodingTools({
        config: params.cfg,
        workspaceDir,
        sessionKey: params.sessionKey,
        messageProvider: params.command.channel,
        groupId: params.sessionEntry?.groupId ?? undefined,
        groupChannel: params.sessionEntry?.groupChannel ?? undefined,
        groupSpace: params.sessionEntry?.space ?? undefined,
        spawnedBy: params.sessionEntry?.spawnedBy ?? undefined,
        senderIsOwner: params.command.senderIsOwner,
        modelProvider: params.provider,
        modelId: params.model,
      });
    } catch {
      return [];
    }
  })();
  const toolSummaries = buildToolSummaryMap(tools);
  const toolNames = tools.map((t) => t.name);
  const { sessionAgentId } = resolveSessionAgentIds({
    sessionKey: params.sessionKey,
    config: params.cfg,
  });
  const defaultModelRef = resolveDefaultModelForAgent({
    cfg: params.cfg,
    agentId: sessionAgentId,
  });
  const defaultModelLabel = `${defaultModelRef.provider}/${defaultModelRef.model}`;
  const { runtimeInfo, userTimezone, userTime, userTimeFormat } = buildSystemPromptParams({
    config: params.cfg,
    agentId: sessionAgentId,
    workspaceDir,
    cwd: process.cwd(),
    runtime: {
      host: "unknown",
      os: "unknown",
      arch: "unknown",
      node: process.version,
      model: `${params.provider}/${params.model}`,
      defaultModel: defaultModelLabel,
    },
  });
  const sandboxInfo = sandboxRuntime.sandboxed
    ? {
        enabled: true,
        workspaceDir,
        workspaceAccess: "rw" as const,
        elevated: {
          allowed: params.elevated.allowed,
          defaultLevel: (params.resolvedElevatedLevel ?? "off") as "on" | "off" | "ask" | "full",
        },
      }
    : { enabled: false };
  const ttsHint = params.cfg ? buildTtsSystemPromptHint(params.cfg) : undefined;

  const promptArtifacts = buildAgentSystemPromptArtifacts({
    workspaceDir,
    defaultThinkLevel: params.resolvedThinkLevel,
    reasoningLevel: params.resolvedReasoningLevel,
    extraSystemPrompt: undefined,
    ownerNumbers: undefined,
    reasoningTagHint: false,
    toolNames,
    toolSummaries,
    modelAliasLines: [],
    userTimezone,
    userTime,
    userTimeFormat,
    contextFiles: injectedFiles,
    skillsPrompt,
    heartbeatPrompt: undefined,
    ttsHint,
    runtimeInfo,
    sandboxInfo,
    memoryCitationsMode: params.cfg?.memory?.citations,
    toolManuals: buildToolOperatorManualMap(tools),
  });
  const systemPrompt = promptArtifacts.prompt;

  return buildSystemPromptReport({
    source: "estimate",
    generatedAt: Date.now(),
    sessionId: params.sessionEntry?.sessionId,
    sessionKey: params.sessionKey,
    provider: params.provider,
    model: params.model,
    workspaceDir,
    bootstrapMaxChars,
    sandbox: { mode: sandboxRuntime.mode, sandboxed: sandboxRuntime.sandboxed },
    systemPrompt,
    promptAssembly: promptArtifacts,
    bootstrapFiles,
    injectedFiles,
    skillsPrompt,
    resolvedSkills: (skillsSnapshot.resolvedSkills ?? []).map((skill) => ({
      name: skill.name,
      source: (skill as { source?: string }).source,
    })),
    availableSkillsCount: skillsSnapshot.skills.length,
    loadedSkillsCount: skillsSnapshot.resolvedSkills?.length ?? 0,
    tools,
  });
}

async function loadProjectedContextReport(
  params: HandleCommandsParams,
): Promise<SessionSystemPromptReport> {
  const report = await loadContextReport(params);
  const sessionId = params.sessionEntry?.sessionId?.trim();
  if (!sessionId) {
    return report;
  }

  const { sessionAgentId } = resolveSessionAgentIds({
    sessionKey: params.sessionKey,
    config: params.cfg,
  });
  const sessionFile = resolveSessionFilePath(sessionId, params.sessionEntry, {
    agentId: sessionAgentId,
  });

  try {
    const sessionManager = SessionManager.open(sessionFile);
    const projection = await projectConversationForModel({
      sessionManager,
      sessionId,
      sessionKey: params.sessionKey,
      taskId: resolveSessionTaskId({ entry: params.sessionEntry }),
      config: params.cfg,
      provider: params.provider,
      modelId: params.model,
      contextWindowTokens:
        typeof params.contextTokens === "number" && params.contextTokens > 0
          ? params.contextTokens
          : undefined,
      systemPromptReport: report,
      sanitizeOptions: { recordModelSnapshot: false },
    });
    return attachModelViewToSystemPromptReport(report, projection.usage);
  } catch {
    return report;
  }
}

export async function buildContextReply(params: HandleCommandsParams): Promise<ReplyPayload> {
  const args = parseContextArgs(params.command.commandBodyNormalized);
  const sub = args.split(/\s+/).filter(Boolean)[0]?.toLowerCase() ?? "";

  if (!sub || sub === "help") {
    return {
      text: [
        "🧠 /context",
        "",
        "What counts as context (high-level), plus a breakdown mode.",
        "",
        "Try:",
        "- /context list   (short breakdown)",
        "- /context detail (per-file + per-tool + per-skill + system prompt size)",
        "- /context json   (same, machine-readable)",
        "",
        "Inline shortcut = a command token inside a normal message (e.g. “hey /status”). It runs immediately (allowlisted senders only) and is stripped before the model sees the remaining text.",
      ].join("\n"),
    };
  }

  const report = await loadProjectedContextReport(params);
  const session = {
    totalTokens: params.sessionEntry?.totalTokens ?? null,
    inputTokens: params.sessionEntry?.inputTokens ?? null,
    outputTokens: params.sessionEntry?.outputTokens ?? null,
    contextTokens: params.contextTokens ?? null,
  } as const;
  const inspector = buildContextInspectorData({
    report,
    session,
    sessionEntry: params.sessionEntry,
  });

  if (sub === "json") {
    return { text: JSON.stringify({ report, session, inspector }, null, 2) };
  }

  if (sub !== "list" && sub !== "show" && sub !== "detail" && sub !== "deep") {
    return {
      text: [
        "Unknown /context mode.",
        "Use: /context, /context list, /context detail, or /context json",
      ].join("\n"),
    };
  }

  const fileLines = report.injectedWorkspaceFiles.map((f) => {
    const status = f.missing ? "MISSING" : f.truncated ? "TRUNCATED" : "OK";
    const raw = f.missing ? "0" : formatCharsAndTokens(f.rawChars);
    const injected = f.missing ? "0" : formatCharsAndTokens(f.injectedChars);
    const extras = [
      f.sourceGroup ? `source=${f.sourceGroup}` : null,
      f.synthetic ? "synthetic" : null,
    ]
      .filter(Boolean)
      .join(" | ");
    return `- ${f.name}: ${status} | raw ${raw} | injected ${injected}${extras ? ` | ${extras}` : ""}`;
  });

  const sandboxLine = `Sandbox: mode=${report.sandbox?.mode ?? "unknown"} sandboxed=${report.sandbox?.sandboxed ?? false}`;
  const toolSchemaLine = `Tool schemas (JSON): ${formatCharsAndTokens(report.tools.schemaChars)} (counts toward context; not shown as text)`;
  const toolListLine = `Tool list (system prompt text): ${formatCharsAndTokens(report.tools.listChars)}`;
  const skillNameSet = new Set(report.skills.entries.map((s) => s.name));
  const skillNames = Array.from(skillNameSet);
  const toolNames = report.tools.entries.map((t) => t.name);
  const formatNameList = (names: string[], cap: number) =>
    names.length <= cap
      ? names.join(", ")
      : `${names.slice(0, cap).join(", ")}, … (+${names.length - cap} more)`;
  const skillsLine = `Skills list (system prompt text): ${formatCharsAndTokens(report.skills.promptChars)} (${inspector.skills.loadedCount}/${inspector.skills.availableCount} prompt-visible/eligible)`;
  const skillsNamesLine = skillNameSet.size
    ? `Skills: ${formatNameList(skillNames, 20)}`
    : "Skills: (none)";
  const toolsNamesLine = toolNames.length
    ? `Tools: ${formatNameList(toolNames, 30)}`
    : "Tools: (none)";
  const systemPromptLine = `System prompt (${report.source}): ${formatCharsAndTokens(report.systemPrompt.chars)} (Project Context ${formatCharsAndTokens(report.systemPrompt.projectContextChars)})`;
  const modelVisibleLine = report.modelView
    ? (() => {
        const pressure =
          typeof report.modelView.contextPressure === "number"
            ? ` (${formatPercent(report.modelView.contextPressure)})`
            : "";
        const windowSuffix =
          typeof report.modelView.contextWindowTokens === "number"
            ? ` / ${formatTokenCount(report.modelView.contextWindowTokens)} window`
            : "";
        const freeSuffix =
          typeof inspector.freeTokens === "number"
            ? ` · free ${formatTokenCount(inspector.freeTokens)}`
            : "";
        return `Model-visible payload: ${formatTokenCount(report.modelView.projectedTotalTokens)}${windowSuffix}${pressure}${freeSuffix}`;
      })()
    : null;
  const branchHistoryLine = report.modelView
    ? `Branch history: ${formatInt(report.modelView.branchHistoryMessages)} messages / ${formatTokenCount(report.modelView.branchHistoryTokens)}`
    : null;
  const scopedHistoryLine = report.modelView
    ? `Task-scoped history: ${formatInt(report.modelView.scopedHistoryMessages)} messages / ${formatTokenCount(report.modelView.scopedHistoryTokens)}${report.modelView.taskScoped ? " (active)" : " (full branch)"}`
    : null;
  const projectedHistoryLine = report.modelView
    ? `Model-visible history: ${formatInt(report.modelView.projectedHistoryMessages)} messages / ${formatTokenCount(report.modelView.projectedHistoryTokens)}`
    : null;
  const historyGuardsLine = report.modelView
    ? [
        report.modelView.taskScoped ? "task scope active" : "full branch visible",
        typeof report.modelView.dmHistoryLimit === "number"
          ? `DM limit=${report.modelView.dmHistoryLimit}`
          : null,
        report.modelView.truncatedToolResults > 0
          ? `truncated tool results=${report.modelView.truncatedToolResults}`
          : "truncated tool results=0",
        `compactions=${inspector.status.compactionCount}`,
      ]
        .filter(Boolean)
        .join(" | ")
    : null;
  const categoryLines = inspector.categoryBreakdown.map((entry) => {
    const share = typeof entry.share === "number" ? ` (${formatPercent(entry.share)})` : "";
    return `- ${entry.label}: ${formatTokenCount(entry.tokens)}${share}`;
  });
  const rewriteLines = inspector.rewrites.flatMap((stage, index) => {
    if (index === 0 || !stage.changed) {
      return [];
    }
    const previous = inspector.rewrites[index - 1];
    if (!previous) {
      return [];
    }
    const delta =
      stage.savingsTokens > 0 ? ` · saved ${formatTokenCount(stage.savingsTokens)}` : "";
    return [
      `- ${stage.label}: ${formatInt(previous.messages)} msg / ${formatTokenCount(previous.tokens)} -> ${formatInt(stage.messages)} msg / ${formatTokenCount(stage.tokens)}${delta}`,
    ];
  });
  const sourceSummaryLines = inspector.sourceBreakdown.map(
    (group) =>
      `- ${group.source}: ${formatTokenCount(group.totalTokens)} across ${formatInt(group.contributors.length)} contributor(s)`,
  );
  const sourceDetailLines = inspector.sourceBreakdown.flatMap((group) => {
    const header = `${group.source} (${formatTokenCount(group.totalTokens)})`;
    const contributors = group.contributors.map((contributor) => {
      const detail = contributor.detail ? ` | ${contributor.detail}` : "";
      return `- ${contributor.name}: ${formatTokenCount(contributor.tokens)}${detail}`;
    });
    return [header, ...contributors, ""];
  });
  const skillSourceLines = inspector.skills.sourceBreakdown.map(
    (group) =>
      `- ${group.source}: ${group.count} skill(s) / ${formatTokenCount(group.tokens)} (${formatNameList(group.names, 10)})`,
  );
  const suggestionLines = inspector.suggestions.map(
    (suggestion) =>
      `- ${suggestion.severity.toUpperCase()}: ${suggestion.title} (${formatTokenCount(suggestion.estimatedTokenSavings)} est.) — ${suggestion.detail}`,
  );
  const memoryLines =
    inspector.files.memoryFiles.length > 0
      ? inspector.files.memoryFiles.map(
          (file) =>
            `- ${file.name}: ${formatTokenCount(file.tokens)}${file.truncated ? " | truncated" : ""}${file.synthetic ? " | synthetic" : ""}`,
        )
      : ["- (none)"];
  const workspaceLabel = report.workspaceDir ?? params.workspaceDir;
  const bootstrapMaxLabel =
    typeof report.bootstrapMaxChars === "number"
      ? `${formatInt(report.bootstrapMaxChars)} chars`
      : "? chars";

  const totalsLine =
    session.totalTokens != null
      ? `Session tokens (cached): ${formatInt(session.totalTokens)} total / ctx=${session.contextTokens ?? "?"}`
      : `Session tokens (cached): unknown / ctx=${session.contextTokens ?? "?"}`;

  if (sub === "detail" || sub === "deep") {
    const perSkill = formatListTop(
      report.skills.entries.map((s) => ({ name: s.name, value: s.blockChars })),
      30,
    );
    const perToolSchema = formatListTop(
      report.tools.entries.map((t) => ({ name: t.name, value: t.schemaChars })),
      30,
    );
    const perToolSummary = formatListTop(
      report.tools.entries.map((t) => ({ name: t.name, value: t.summaryChars })),
      30,
    );
    const toolPropsLines = report.tools.entries
      .filter((t) => t.propertiesCount != null)
      .toSorted((a, b) => (b.propertiesCount ?? 0) - (a.propertiesCount ?? 0))
      .slice(0, 30)
      .map((t) => `- ${t.name}: ${t.propertiesCount} params`);
    const cacheLine = report.cache
      ? `Prompt cache: ${report.cache.staticPrefixCacheStatus} | static ${formatCharsAndTokens(report.cache.staticPrefixChars)} | dynamic ${formatCharsAndTokens(report.cache.dynamicTailChars)}`
      : null;

    return {
      text: [
        "🧠 Context breakdown (detailed)",
        `Workspace: ${workspaceLabel}`,
        `Bootstrap max/file: ${bootstrapMaxLabel}`,
        sandboxLine,
        systemPromptLine,
        ...(cacheLine ? [cacheLine] : []),
        ...(modelVisibleLine
          ? [modelVisibleLine, branchHistoryLine, scopedHistoryLine, projectedHistoryLine]
          : []),
        ...(historyGuardsLine ? [historyGuardsLine] : []),
        ...(categoryLines.length ? ["", "Category breakdown:", ...categoryLines] : []),
        ...(rewriteLines.length ? ["", "Hidden context rewrites:", ...rewriteLines] : []),
        ...(sourceSummaryLines.length
          ? ["", "Known contributors by source:", ...sourceSummaryLines]
          : []),
        ...(suggestionLines.length ? ["", "Suggestions:", ...suggestionLines] : []),
        "",
        "Injected workspace files:",
        ...fileLines,
        "",
        "Memory files:",
        ...memoryLines,
        "",
        skillsLine,
        skillsNamesLine,
        ...(skillSourceLines.length ? ["Skill sources:", ...skillSourceLines] : []),
        ...(perSkill.lines.length ? ["Top skills (prompt entry size):", ...perSkill.lines] : []),
        ...(perSkill.omitted ? [`… (+${perSkill.omitted} more skills)`] : []),
        "",
        toolListLine,
        toolSchemaLine,
        toolsNamesLine,
        "Top tools (schema size):",
        ...perToolSchema.lines,
        ...(perToolSchema.omitted ? [`… (+${perToolSchema.omitted} more tools)`] : []),
        "",
        "Top tools (summary text size):",
        ...perToolSummary.lines,
        ...(perToolSummary.omitted ? [`… (+${perToolSummary.omitted} more tools)`] : []),
        ...(toolPropsLines.length ? ["", "Tools (param count):", ...toolPropsLines] : []),
        ...(sourceDetailLines.length ? ["", "Contributor details:", ...sourceDetailLines] : []),
        "",
        totalsLine,
        "",
        "Inline shortcut: a command token inside normal text (e.g. “hey /status”) that runs immediately (allowlisted senders only) and is stripped before the model sees the remaining message.",
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }

  return {
    text: [
      "🧠 Context breakdown",
      `Workspace: ${workspaceLabel}`,
      `Bootstrap max/file: ${bootstrapMaxLabel}`,
      sandboxLine,
      systemPromptLine,
      ...(modelVisibleLine
        ? [modelVisibleLine, branchHistoryLine, scopedHistoryLine, projectedHistoryLine]
        : []),
      ...(historyGuardsLine ? [historyGuardsLine] : []),
      ...(categoryLines.length ? ["", "Category breakdown:", ...categoryLines] : []),
      ...(rewriteLines.length ? ["", "Hidden context rewrites:", ...rewriteLines] : []),
      ...(sourceSummaryLines.length
        ? ["", "Known contributors by source:", ...sourceSummaryLines]
        : []),
      ...(suggestionLines.length ? ["", "Suggestions:", ...suggestionLines.slice(0, 3)] : []),
      "",
      "Injected workspace files:",
      ...fileLines,
      "",
      skillsLine,
      skillsNamesLine,
      toolListLine,
      toolSchemaLine,
      toolsNamesLine,
      "",
      totalsLine,
      "",
      "Inline shortcut: a command token inside normal text (e.g. “hey /status”) that runs immediately (allowlisted senders only) and is stripped before the model sees the remaining message.",
    ].join("\n"),
  };
}
