/**
 * Step Context Manager — "Just the right information for the next step"
 *
 * Implements Karpathy's progressive context principle for multi-step task execution.
 * Instead of dumping full task history into every turn, this module:
 *
 * 1. Compresses completed steps into a one-line summary
 * 2. Highlights only: current step + immediate next step
 * 3. Classifies the step's "domain" (browser, filesystem, shell, messaging)
 * 4. Returns tool relevance hints so the prompt can suppress irrelevant tools
 * 5. Signals when browser state should be cleared between steps
 *
 * The goal: the agent sees ~200 tokens of step context instead of ~2000.
 */

import type { EmbeddedContextFile } from "./pi-embedded-helpers.js";
import type { ActiveTaskSummary } from "./task-checkpoint.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("agents/step-context");

// ---------------------------------------------------------------------------
// Step Domain Classification
// ---------------------------------------------------------------------------

/**
 * A step domain indicates what kind of work the current step involves.
 * This drives tool filtering and browser state management.
 */
export type StepDomain =
  | "browser"      // Web interaction: navigate, click, fill forms, scrape
  | "filesystem"   // File read/write/edit, directory operations
  | "shell"        // Run commands, build, test, install
  | "messaging"    // Send messages, notifications, cross-session comms
  | "memory"       // Search/store memory, recall past context
  | "planning"     // Break down work, create sub-tasks
  | "general";     // Unclassified or multi-domain

const DOMAIN_KEYWORDS: Record<StepDomain, string[]> = {
  browser: [
    "browse", "browser", "chrome", "safari", "firefox", "navigate", "url", "http",
    "click", "fill", "form", "submit", "login", "sign in", "signup", "page",
    "website", "web", "scrape", "download page", "screenshot", "tab", "search online",
    "google", "open site", "bookmarks",
  ],
  filesystem: [
    "file", "read", "write", "edit", "create file", "delete file", "move file",
    "copy file", "rename", "directory", "folder", "path", "save", "open file",
    "config file", "json", "yaml", "csv", "txt", "pdf", "docx", "image file",
  ],
  shell: [
    "run", "execute", "command", "shell", "terminal", "bash", "npm", "pip",
    "build", "compile", "test", "install", "deploy", "git", "docker", "make",
    "script", "process", "kill", "restart", "start server", "stop server",
  ],
  messaging: [
    "send", "message", "notify", "telegram", "discord", "slack", "signal",
    "email", "reply", "post", "announce", "share", "dm", "channel",
  ],
  memory: [
    "remember", "recall", "memory", "search memory", "save to memory",
    "past", "previous", "history", "what did", "when did",
  ],
  planning: [
    "plan", "break down", "decompose", "steps", "strategy", "approach",
    "design", "architect", "decide", "evaluate options",
  ],
  general: [],
};

/**
 * Tools that are always available regardless of step domain.
 * These are core tools the agent needs for basic operation.
 */
const ALWAYS_RELEVANT_TOOLS = new Set([
  "read", "write", "edit", "apply_patch", "grep", "find", "ls",
  "exec", "process", "get_task_output",
  "ask_user_question", "task_tracker", "session_status",
  "sleep",
]);

/**
 * Tools that are particularly relevant to each domain.
 * Tools NOT in this set AND not in ALWAYS_RELEVANT are candidates for suppression.
 */
const DOMAIN_TOOL_AFFINITY: Record<StepDomain, Set<string>> = {
  browser: new Set([
    "browser", "web_search", "web_fetch", "canvas", "image",
  ]),
  filesystem: new Set([
    "read", "write", "edit", "apply_patch", "grep", "find", "ls",
  ]),
  shell: new Set([
    "exec", "process", "get_task_output",
  ]),
  messaging: new Set([
    "message", "sessions_send", "sessions_list", "sessions_history",
    "sessions_spawn",
  ]),
  memory: new Set([
    "memory_search", "memory_get",
  ]),
  planning: new Set([
    "task_tracker", "tasks_list", "task_get", "task_plan",
    "sessions_spawn", "delegate", "agents_list",
  ]),
  general: new Set(), // no additional affinity — all tools are fair game
};

// ---------------------------------------------------------------------------
// Step Context Result
// ---------------------------------------------------------------------------

export type StepContextResult = {
  /** The focused prompt section to inject (replaces verbose task dump) */
  promptSection: string;

  /** Classified domain of the current step */
  domain: StepDomain;

  /** Tool names that are particularly relevant for this step */
  relevantTools: string[];

  /** Tool names that can be suppressed from the prompt for this step */
  suppressibleTools: string[];

  /** Whether browser state should be cleared (step transition detected) */
  shouldClearBrowserState: boolean;

  /** Compact metadata for logging */
  meta: {
    taskId: string;
    currentStep: number;
    totalSteps: number;
    domain: StepDomain;
    compressedCompletedCount: number;
  };
};

// ---------------------------------------------------------------------------
// Domain Classification
// ---------------------------------------------------------------------------

/**
 * Classifies what domain a step belongs to based on its text.
 * Uses keyword matching with a simple scoring model.
 */
export function classifyStepDomain(stepText: string): StepDomain {
  if (!stepText?.trim()) {
    return "general";
  }

  const lower = stepText.toLowerCase();
  let bestDomain: StepDomain = "general";
  let bestScore = 0;

  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS) as Array<
    [StepDomain, string[]]
  >) {
    if (domain === "general") {
      continue;
    }

    let score = 0;
    for (const keyword of keywords) {
      if (lower.includes(keyword)) {
        // Longer keywords are more specific, score higher
        score += keyword.length;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestDomain = domain;
    }
  }

  return bestDomain;
}

// ---------------------------------------------------------------------------
// Completed Steps Compression
// ---------------------------------------------------------------------------

/**
 * Compresses completed steps into a single-line summary.
 * Instead of listing every completed step with full details,
 * produces something like: "Steps 1-5 done (opened Chrome, logged in, navigated to settings, updated profile, saved)"
 */
export function compressCompletedSteps(
  completedSteps: string[],
  maxSummaryChars = 200,
): string {
  if (completedSteps.length === 0) {
    return "";
  }

  if (completedSteps.length === 1) {
    const step = completedSteps[0]!;
    // Extract just the action text, dropping the [id] prefix
    const clean = step.replace(/^\[[\w-]+\]\s*/, "").replace(/\s*→.*$/, "");
    return `Previous step done: ${truncate(clean, maxSummaryChars)}`;
  }

  // Extract short action labels from each step
  const actions = completedSteps.map((step) => {
    // Strip [step-id] prefix and → output suffix
    const clean = step.replace(/^\[[\w-]+\]\s*/, "").replace(/\s*→.*$/, "");
    // Take first ~30 chars or first sentence
    const short = clean.length > 35 ? `${clean.slice(0, 32)}...` : clean;
    return short;
  });

  const prefix = `Steps 1-${completedSteps.length} done`;
  const actionsStr = actions.join(", ");

  if (`${prefix} (${actionsStr})`.length <= maxSummaryChars) {
    return `${prefix} (${actionsStr})`;
  }

  // Too long — show first and last action with count
  const first = actions[0];
  const last = actions[actions.length - 1];
  return `${prefix} (${first} → ... → ${last})`;
}

// ---------------------------------------------------------------------------
// Key Outputs Extraction
// ---------------------------------------------------------------------------

/**
 * Extracts only the key outputs that are relevant to the current or next step.
 * Previous step outputs are most likely to be needed.
 */
export function extractRelevantOutputs(
  keyOutputs: string[],
  currentStepIndex: number,
  maxOutputs = 3,
): string[] {
  if (keyOutputs.length === 0) {
    return [];
  }

  // Prefer outputs from the most recent steps (closest to current)
  // keyOutputs are in order: step 0's output, step 1's output, etc.
  const relevant = keyOutputs.slice(
    Math.max(0, currentStepIndex - maxOutputs),
    currentStepIndex,
  );

  return relevant;
}

// ---------------------------------------------------------------------------
// Tool Relevance
// ---------------------------------------------------------------------------

/**
 * Given a step domain and the full list of available tools,
 * returns which tools are relevant and which can be suppressed.
 */
export function computeToolRelevance(
  domain: StepDomain,
  availableTools: string[],
): { relevant: string[]; suppressible: string[] } {
  if (domain === "general") {
    // General domain: everything is relevant
    return { relevant: availableTools, suppressible: [] };
  }

  const domainTools = DOMAIN_TOOL_AFFINITY[domain];
  const relevant: string[] = [];
  const suppressible: string[] = [];

  for (const tool of availableTools) {
    const normalized = tool.toLowerCase();
    if (ALWAYS_RELEVANT_TOOLS.has(normalized) || domainTools.has(normalized)) {
      relevant.push(tool);
    } else {
      suppressible.push(tool);
    }
  }

  return { relevant, suppressible };
}

// ---------------------------------------------------------------------------
// Main: Build Step Context
// ---------------------------------------------------------------------------

/**
 * The main entry point. Takes an ActiveTaskSummary and produces a focused,
 * minimal context section that follows Karpathy's "just the right info" principle.
 *
 * @param task - The active task summary from task-checkpoint
 * @param availableTools - All tool names currently available to the agent
 * @param previousStepIndex - The step index from the previous turn (for transition detection)
 * @returns StepContextResult with focused prompt, tool hints, and transition signals
 */
export function buildStepContext(
  task: ActiveTaskSummary,
  availableTools: string[] = [],
  previousStepIndex?: number,
): StepContextResult {
  const currentStepText = task.currentStepText ?? "";
  const domain = classifyStepDomain(currentStepText);
  const { relevant, suppressible } = computeToolRelevance(domain, availableTools);

  // Detect step transition (for browser state clearing)
  const stepTransitioned =
    previousStepIndex !== undefined && previousStepIndex !== task.currentStepIndex;

  // Compress completed steps
  const completedSummary = compressCompletedSteps(task.stepsCompleted);

  // Extract only relevant outputs (from recent steps)
  const relevantOutputs = extractRelevantOutputs(
    task.keyOutputs,
    task.currentStepIndex,
  );

  // Build the focused prompt section
  const lines: string[] = [];

  lines.push(`## Active Task: ${task.title}`);
  lines.push(`Progress: ${task.completedSteps}/${task.totalSteps} steps`);

  if (task.goal) {
    lines.push(`Goal: ${task.goal}`);
  }

  // Compressed completed steps (one line instead of N lines)
  if (completedSummary) {
    lines.push(completedSummary);
  }

  // Recent outputs that might be needed for current step
  if (relevantOutputs.length > 0) {
    lines.push("");
    lines.push("Recent outputs:");
    for (const output of relevantOutputs) {
      lines.push(`  ${output}`);
    }
  }

  // Current step — the focus
  if (currentStepText) {
    lines.push("");
    lines.push(`>>> CURRENT STEP (${task.currentStepIndex + 1}/${task.totalSteps}): ${currentStepText}`);
  }

  // Next action hint
  if (task.nextAction) {
    lines.push(`Next action: ${task.nextAction}`);
  }

  // Peek at next step (just the text, no details)
  if (task.stepsRemaining.length > 1) {
    const nextStep = task.stepsRemaining[1]; // [0] is current, [1] is next
    if (nextStep) {
      const nextClean = nextStep.replace(/^\[[\w-]+\]\s*/, "");
      lines.push(`After this: ${nextClean}`);
    }
  }

  // Blockers (always show — they block everything)
  if (task.blockers.length > 0) {
    lines.push("");
    lines.push(`BLOCKED: ${task.blockers.join("; ")}`);
  }

  // Constraints (always show — they constrain everything)
  if (task.constraints.length > 0) {
    lines.push(`Constraints: ${task.constraints.join("; ")}`);
  }

  // Domain hint for the agent
  if (domain !== "general") {
    lines.push(`Step domain: ${domain}`);
  }

  if (relevant.length > 0 && relevant.length < availableTools.length) {
    lines.push(`Prefer tools now: ${summarizeToolNames(relevant)}`);
  }

  if (suppressible.length > 0) {
    lines.push(`De-emphasize unless needed: ${summarizeToolNames(suppressible)}`);
  }

  const promptSection = lines.join("\n");

  log.info("step context built", {
    taskId: task.taskId,
    step: task.currentStepIndex,
    total: task.totalSteps,
    domain,
    promptChars: promptSection.length,
    compressedSteps: task.stepsCompleted.length,
    transitioned: stepTransitioned,
  });

  return {
    promptSection,
    domain,
    relevantTools: relevant,
    suppressibleTools: suppressible,
    shouldClearBrowserState: stepTransitioned && domain !== "browser",
    meta: {
      taskId: task.taskId,
      currentStep: task.currentStepIndex,
      totalSteps: task.totalSteps,
      domain,
      compressedCompletedCount: task.stepsCompleted.length,
    },
  };
}

// ---------------------------------------------------------------------------
// Browser State Transition
// ---------------------------------------------------------------------------

/**
 * Determines whether browser state (network logs, console errors, etc.)
 * should be cleared when transitioning between steps.
 *
 * Rules:
 * - Always clear when transitioning FROM a browser step to a non-browser step
 * - Always clear when transitioning between different browser steps
 *   (each step should see a clean slate)
 * - Don't clear if we're still on the same step (no transition)
 */
export function shouldClearBrowserStateOnTransition(
  previousDomain: StepDomain | undefined,
  currentDomain: StepDomain,
  stepTransitioned: boolean,
): boolean {
  if (!stepTransitioned) {
    return false;
  }

  // Transitioning FROM browser → always clear
  if (previousDomain === "browser") {
    return true;
  }

  // Transitioning TO browser from non-browser → clear for a fresh start
  if (currentDomain === "browser") {
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 3)}...`;
}

/**
 * Builds a compact "step context" replacement for the verbose
 * `buildTaskBootstrapContext` when step-aware mode is active.
 *
 * This is a drop-in replacement that produces ~200 tokens instead of ~2000.
 */
export function buildFocusedTaskBootstrapContext(task: ActiveTaskSummary): string {
  const result = buildStepContext(task);
  return result.promptSection;
}

/**
 * Derives the step-focused prompt inputs for a live turn.
 *
 * When an active task exists, this:
 * - computes step context for the current tool surface
 * - filters the prompt-visible tool list to the tools relevant for this step
 * - removes the injected ACTIVE_TASK context file to avoid duplicate task dumps
 */
export function buildStepScopedPromptInputs(params: {
  task?: ActiveTaskSummary | null;
  toolNames: string[];
  contextFiles?: EmbeddedContextFile[];
}): {
  stepContext?: StepContextResult;
  promptToolNames: string[];
  contextFiles: EmbeddedContextFile[];
} {
  const contextFiles = params.contextFiles ?? [];
  const task = params.task;
  if (!task) {
    return {
      stepContext: undefined,
      promptToolNames: params.toolNames,
      contextFiles,
    };
  }

  const stepContext = buildStepContext(task, params.toolNames);
  const relevantTools = new Set(stepContext.relevantTools.map((name) => name.toLowerCase()));
  const promptToolNames = params.toolNames.filter((name) => relevantTools.has(name.toLowerCase()));
  return {
    stepContext,
    promptToolNames: promptToolNames.length > 0 ? promptToolNames : params.toolNames,
    contextFiles: contextFiles.filter(
      (file) => file.path.trim().toUpperCase() !== "ACTIVE_TASK",
    ),
  };
}

function summarizeToolNames(toolNames: string[], maxItems = 8): string {
  if (toolNames.length <= maxItems) {
    return toolNames.join(", ");
  }
  const visible = toolNames.slice(0, maxItems).join(", ");
  return `${visible}, +${toolNames.length - maxItems} more`;
}
