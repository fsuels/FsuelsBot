/**
 * Coherence Log — RSC-inspired decision memory.
 *
 * Captures key agent decisions from structured signals (tool calls, task
 * transitions) and stores them in a capped FIFO log on the session.
 *
 * v2.0: Capture only (no semantic intervention).
 * v2.1: Will add pre-turn contradiction warnings.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single captured decision entry. */
export type CoherenceEntry = {
  /** Timestamp (ms) when the decision was captured. */
  ts: number;
  /** Source of the decision signal. */
  source: "tool_call" | "task_transition" | "model_switch" | "session_reset";
  /** Short human-readable summary of the decision. */
  summary: string;
  /** Optional task context when the decision was made. */
  taskId?: string;
};

export type CoherenceLogState = {
  /** Capped FIFO log of decisions. */
  entries: CoherenceEntry[];
  /** Reserved entries for task-defining decisions (persist until task completes). */
  pinned: CoherenceEntry[];
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum entries in the rolling FIFO log. */
const MAX_LOG_ENTRIES = 20;

/** Maximum pinned (task-defining) entries. */
const MAX_PINNED_ENTRIES = 3;

/** Tool names that represent decisions (not observation/read tools). */
const DECISION_TOOLS = new Set([
  "write",
  "edit",
  "apply_patch",
  "exec",
  "message",
  "sessions_spawn",
  "sessions_send",
  "cron",
  "gateway",
  "memory_set",
]);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function createInitialCoherenceLog(): CoherenceLogState {
  return { entries: [], pinned: [] };
}

/**
 * Resolve coherence log state from session metadata fields.
 */
export function resolveCoherenceLog(raw: {
  coherenceEntries?: unknown;
  coherencePinned?: unknown;
}): CoherenceLogState {
  const entries = Array.isArray(raw.coherenceEntries)
    ? (raw.coherenceEntries as CoherenceEntry[]).slice(-MAX_LOG_ENTRIES)
    : [];
  const pinned = Array.isArray(raw.coherencePinned)
    ? (raw.coherencePinned as CoherenceEntry[]).slice(-MAX_PINNED_ENTRIES)
    : [];
  return { entries, pinned };
}

/**
 * Append a new decision entry to the coherence log.
 * Returns the updated state.
 */
export function appendCoherenceEntry(
  state: CoherenceLogState,
  entry: CoherenceEntry,
): CoherenceLogState {
  const entries = [...state.entries, entry].slice(-MAX_LOG_ENTRIES);
  return { ...state, entries };
}

/**
 * Pin a task-defining decision (persists until task completes).
 */
export function pinCoherenceEntry(
  state: CoherenceLogState,
  entry: CoherenceEntry,
): CoherenceLogState {
  const pinned = [...state.pinned, entry].slice(-MAX_PINNED_ENTRIES);
  return { ...state, pinned };
}

/**
 * Clear pinned entries for a completed task.
 */
export function clearPinnedForTask(state: CoherenceLogState, taskId: string): CoherenceLogState {
  const pinned = state.pinned.filter((e) => e.taskId !== taskId);
  return { ...state, pinned };
}

/**
 * Build a coherence entry from a tool call.
 * Only captures tool calls that represent decisions (not reads/searches).
 */
export function buildToolCallCoherenceEntry(params: {
  toolName: string;
  toolParams: Record<string, unknown>;
  taskId?: string;
  now?: number;
}): CoherenceEntry | null {
  const now = params.now ?? Date.now();
  const name = params.toolName.toLowerCase();

  // Only capture decision-making tool calls, not observation/read tools
  if (!DECISION_TOOLS.has(name)) return null;

  const summary = summarizeToolCall(name, params.toolParams);
  if (!summary) return null;

  return {
    ts: now,
    source: "tool_call",
    summary,
    taskId: params.taskId,
  };
}

/**
 * Build a coherence entry from a task transition.
 */
export function buildTaskTransitionEntry(params: {
  fromTaskId?: string;
  toTaskId: string;
  toTaskTitle?: string;
  now?: number;
}): CoherenceEntry {
  const now = params.now ?? Date.now();
  const label = params.toTaskTitle || params.toTaskId;
  return {
    ts: now,
    source: "task_transition",
    summary: params.fromTaskId
      ? `Switched from task "${params.fromTaskId}" to "${label}"`
      : `Started task "${label}"`,
    taskId: params.toTaskId,
  };
}

/**
 * Build a coherence entry from a model switch.
 */
export function buildModelSwitchEntry(params: {
  fromModel?: string;
  toModel: string;
  reason?: string;
  taskId?: string;
  now?: number;
}): CoherenceEntry {
  const now = params.now ?? Date.now();
  const reason = params.reason ? ` (${params.reason})` : "";
  return {
    ts: now,
    source: "model_switch",
    summary: params.fromModel
      ? `Model changed from ${params.fromModel} to ${params.toModel}${reason}`
      : `Using model ${params.toModel}${reason}`,
    taskId: params.taskId,
  };
}

/**
 * Build a coherence entry from a tool meta summary (post-turn).
 * Uses the pre-computed meta string from toolMetas instead of raw params.
 * Only captures decision-making tool calls, not reads/searches.
 */
export function buildToolMetaCoherenceEntry(params: {
  toolName: string;
  meta?: string;
  taskId?: string;
  now?: number;
}): CoherenceEntry | null {
  const name = params.toolName.toLowerCase();
  if (!DECISION_TOOLS.has(name)) return null;

  const summary = params.meta ? `${capitalize(name)}: ${params.meta}` : `${capitalize(name)} call`;

  return {
    ts: params.now ?? Date.now(),
    source: "tool_call",
    summary,
    taskId: params.taskId,
  };
}

/**
 * Format the coherence log for human-readable CLI output.
 */
export function formatCoherenceLog(state: CoherenceLogState): string {
  const lines: string[] = [
    `Coherence Log: ${state.entries.length}/${MAX_LOG_ENTRIES} entries, ${state.pinned.length}/${MAX_PINNED_ENTRIES} pinned`,
  ];

  if (state.pinned.length > 0) {
    lines.push("", "Pinned (task-defining):");
    for (const entry of state.pinned) {
      const age = Math.floor((Date.now() - entry.ts) / 60_000);
      lines.push(`  [${age}m ago] [${entry.source}] ${entry.summary}`);
    }
  }

  if (state.entries.length > 0) {
    lines.push("", "Recent decisions:");
    // Show last 10 for CLI brevity
    const recent = state.entries.slice(-10);
    for (const entry of recent) {
      const age = Math.floor((Date.now() - entry.ts) / 60_000);
      lines.push(`  [${age}m ago] [${entry.source}] ${entry.summary}`);
    }
    if (state.entries.length > 10) {
      lines.push(`  ... and ${state.entries.length - 10} older entries`);
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function summarizeToolCall(name: string, params: Record<string, unknown>): string | null {
  switch (name) {
    case "write": {
      const path =
        typeof params.path === "string"
          ? params.path
          : typeof params.file === "string"
            ? params.file
            : null;
      return path ? `Write file: ${path}` : "Write file";
    }
    case "edit": {
      const path =
        typeof params.path === "string"
          ? params.path
          : typeof params.file === "string"
            ? params.file
            : null;
      return path ? `Edit file: ${path}` : "Edit file";
    }
    case "apply_patch":
      return "Apply multi-file patch";
    case "exec": {
      const cmd = typeof params.command === "string" ? params.command.slice(0, 80) : null;
      return cmd ? `Execute: ${cmd}` : "Execute shell command";
    }
    case "message": {
      const action = typeof params.action === "string" ? params.action : "send";
      const to = typeof params.to === "string" ? params.to : null;
      return to ? `Message (${action}) to ${to}` : `Message action: ${action}`;
    }
    case "sessions_spawn": {
      const task = typeof params.task === "string" ? params.task.slice(0, 60) : null;
      return task ? `Spawn subagent: ${task}` : "Spawn subagent";
    }
    case "sessions_send": {
      const key = typeof params.sessionKey === "string" ? params.sessionKey : null;
      return key ? `Send to session: ${key}` : "Send to session";
    }
    case "cron":
      return "Schedule cron job";
    case "gateway": {
      const action = typeof params.action === "string" ? params.action : null;
      return action ? `Gateway: ${action}` : "Gateway action";
    }
    case "memory_set":
      return "Store memory entry";
    default:
      return null;
  }
}
