/**
 * Coherence Log — RSC-inspired decision memory.
 *
 * Captures key agent decisions from structured signals (tool calls, task
 * transitions) and stores them in a capped FIFO log on the session.
 *
 * Coherence entries represent state-changing events, not explanations.
 *
 * v2.0: Capture only (no semantic intervention).
 * v2.1: Pre-turn contradiction warnings + tool avoidance.
 * v3.0: Event Memory — structured verb/subject/outcome fields for
 *        associative recall. Entries are indexed by verb at query time
 *        and scored by relevance (not just recency) for pre-turn injection.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Controlled vocabulary for event verbs (RSC v3.0).
 * Each verb answers a distinct future question:
 *   CHANGED  → "What actually changed?"
 *   FAILED   → "What didn't work?"
 *   DECIDED  → "What are we committed to?"
 *   REJECTED → "What should we not do again?"
 *   BLOCKED  → "Why are we stuck?"
 *   ESCALATED → "Why did control change?"
 *   COMPACTED → "Why might context feel missing?"
 */
export const EventVerb = {
  /** Successful state-changing tool call. */
  CHANGED: "changed",
  /** Tool call or operation failed. */
  FAILED: "failed",
  /** Deliberate choice (task switch, model switch, plan confirmation). */
  DECIDED: "decided",
  /** Action invalidated or user-corrected (session reset). */
  REJECTED: "rejected",
  /** Progress stopped by external factor (context overflow). */
  BLOCKED: "blocked",
  /** Elevated to user or higher model (model fallback). */
  ESCALATED: "escalated",
  /** Session was compacted (continuity boundary marker). */
  COMPACTED: "compacted",
} as const;
export type EventVerb = (typeof EventVerb)[keyof typeof EventVerb];

/** A single captured decision entry. */
export type CoherenceEntry = {
  /** Timestamp (ms) when the decision was captured. */
  ts: number;
  /** Source of the decision signal. */
  source: "tool_call" | "task_transition" | "model_switch" | "session_reset" | "compaction";
  /** Short human-readable summary of the decision. */
  summary: string;
  /** Optional task context when the decision was made. */
  taskId?: string;
  // --- RSC v3.0 Event Memory fields (all optional for backward compat) ---
  /** Structured event verb. Absent on legacy entries pre-v3.0. */
  verb?: EventVerb;
  /** Primary entity affected (file path, tool name, task label). */
  subject?: string;
  /** Result description (e.g., "ok", error snippet, "fallback"). */
  outcome?: string;
};

/** Returns true if the entry has structured event fields (RSC v3.0). */
export function isStructuredEvent(
  entry: CoherenceEntry,
): entry is CoherenceEntry & { verb: EventVerb } {
  return entry.verb !== undefined;
}

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
    verb: EventVerb.CHANGED,
    subject: extractSubjectFromParams(name, params.toolParams) || name,
    outcome: "ok",
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
  const outcomeVerb = params.fromTaskId ? "switched" : "started";
  return {
    ts: now,
    source: "task_transition",
    summary: params.fromTaskId
      ? `Switched from task "${params.fromTaskId}" to "${label}"`
      : `Started task "${label}"`,
    taskId: params.toTaskId,
    verb: EventVerb.DECIDED,
    subject: `task "${label}"`,
    outcome: outcomeVerb,
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
    verb: EventVerb.DECIDED,
    subject: params.toModel,
    outcome: params.reason || "model switch",
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
    verb: EventVerb.CHANGED,
    subject: params.meta || name,
    outcome: "ok",
  };
}

/**
 * Build a coherence entry for a system-level event (RSC v3.0).
 * Used for compaction, context overflow, session reset, and tool failure signals.
 */
export function buildSystemEventEntry(params: {
  verb: EventVerb;
  subject: string;
  outcome: string;
  taskId?: string;
  now?: number;
}): CoherenceEntry {
  const now = params.now ?? Date.now();
  const sourceMap: Record<string, CoherenceEntry["source"]> = {
    [EventVerb.COMPACTED]: "compaction",
    [EventVerb.BLOCKED]: "session_reset",
    [EventVerb.REJECTED]: "session_reset",
    [EventVerb.ESCALATED]: "model_switch",
    [EventVerb.FAILED]: "tool_call",
  };
  return {
    ts: now,
    source: sourceMap[params.verb] ?? "session_reset",
    summary: `${params.verb.toUpperCase()} ${params.subject} → ${params.outcome}`,
    taskId: params.taskId,
    verb: params.verb,
    subject: params.subject,
    outcome: params.outcome,
  };
}

// ---------------------------------------------------------------------------
// Event Memory — scoring, selection, injection (RSC v3.0)
// ---------------------------------------------------------------------------

/** Maximum event lines to include in the prompt injection. */
const MAX_EVENT_LINES = 8;

/** Half-life (minutes) for recency decay in event scoring. */
const RECENCY_HALF_LIFE_MINUTES = 10;

/** Verb-specific score bonuses. Higher = more likely to surface. */
const VERB_BONUS: Partial<Record<EventVerb, number>> = {
  [EventVerb.FAILED]: 4,
  [EventVerb.BLOCKED]: 3,
  [EventVerb.ESCALATED]: 3,
  [EventVerb.DECIDED]: 2,
  [EventVerb.REJECTED]: 2,
  // CHANGED and COMPACTED get 0 bonus (low signal unless recent/pinned)
};

/**
 * Score a structured event for injection priority.
 * Higher score = more relevant = more likely to be shown.
 */
export function scoreEvent(event: CoherenceEntry, pinned: CoherenceEntry[], now?: number): number {
  const ts = now ?? Date.now();
  let score = 0;
  const ageMinutes = (ts - event.ts) / 60_000;

  // Pinned entries are high signal
  if (pinned.some((p) => p.ts === event.ts && p.summary === event.summary)) {
    score += 10;
  }

  // Recency: exponential decay with configurable half-life
  score += 5 * Math.exp((-0.693 * ageMinutes) / RECENCY_HALF_LIFE_MINUTES);

  // Verb bonus
  if (event.verb) {
    score += VERB_BONUS[event.verb] ?? 0;
  }

  return score;
}

/**
 * Select the top-scoring structured events for prompt injection.
 * Returns empty array if no structured events exist (self-gating).
 */
export function selectEventsForInjection(state: CoherenceLogState, now?: number): CoherenceEntry[] {
  const all = [...state.pinned, ...state.entries];
  const structured = all.filter(isStructuredEvent);
  if (structured.length === 0) return [];

  // Deduplicate (same entry may be in both pinned and entries)
  const seen = new Set<string>();
  const unique = structured.filter((e) => {
    const key = `${e.ts}:${e.summary}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const scored = unique.map((e) => ({ event: e, score: scoreEvent(e, state.pinned, now) }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, MAX_EVENT_LINES).map((s) => s.event);
}

/**
 * Format a relative age string (e.g., "3m ago", "1h ago", "<1m ago").
 */
function formatAge(ts: number, now?: number): string {
  const elapsed = ((now ?? Date.now()) - ts) / 60_000;
  if (elapsed < 1) return "<1m ago";
  if (elapsed < 60) return `${Math.floor(elapsed)}m ago`;
  return `${Math.floor(elapsed / 60)}h ago`;
}

/**
 * Format the event memory injection text for the system prompt.
 * Returns null if no events to inject (self-gating).
 */
export function formatEventMemoryInjection(events: CoherenceEntry[], now?: number): string | null {
  if (events.length === 0) return null;

  const lines: string[] = ["## Event Memory"];
  for (const e of events) {
    const verb = (e.verb ?? "unknown").toUpperCase();
    const subject = e.subject ?? "unknown";
    const outcome = e.outcome ?? "";
    const age = formatAge(e.ts, now);
    lines.push(`- ${verb} ${subject} → ${outcome} (${age})`);
  }

  // Build associative recall footer from top unique verbs
  const hints: string[] = [];
  const seenVerbs = new Set<string>();
  for (const e of events) {
    if (!e.verb || seenVerbs.has(e.verb)) continue;
    seenVerbs.add(e.verb);
    const label = VERB_QUESTION_MAP[e.verb];
    if (label && e.subject) {
      hints.push(`${label}: ${e.subject}`);
    }
    if (hints.length >= 3) break;
  }
  if (hints.length > 0) {
    lines.push(hints.join(". ") + ".");
  }

  return lines.join("\n");
}

/** Maps verbs to natural-language recall questions for the footer. */
const VERB_QUESTION_MAP: Partial<Record<EventVerb, string>> = {
  [EventVerb.FAILED]: "What failed",
  [EventVerb.DECIDED]: "What was decided",
  [EventVerb.CHANGED]: "What changed",
  [EventVerb.BLOCKED]: "What is blocked",
  [EventVerb.REJECTED]: "What was rejected",
  [EventVerb.ESCALATED]: "What was escalated",
  [EventVerb.COMPACTED]: "Compacted",
};

/**
 * Format event memory status for CLI display (drift-status command).
 */
export function formatEventMemoryStatus(state: CoherenceLogState, now?: number): string {
  const all = [...state.pinned, ...state.entries];
  const structured = all.filter(isStructuredEvent);

  if (structured.length === 0) {
    return "Event Memory: no structured events (pre-v3.0 entries only)";
  }

  // Count by verb
  const verbCounts = new Map<string, number>();
  for (const e of structured) {
    if (e.verb) {
      verbCounts.set(e.verb, (verbCounts.get(e.verb) ?? 0) + 1);
    }
  }

  const distribution = [...verbCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([v, c]) => `${v}=${c}`)
    .join(", ");

  const selected = selectEventsForInjection(state, now);
  const lines: string[] = [
    `Event Memory: ${structured.length} structured events (${distribution})`,
  ];

  if (selected.length > 0) {
    lines.push("", "Top events for injection:");
    for (const e of selected.slice(0, 5)) {
      const verb = (e.verb ?? "?").toUpperCase();
      const age = formatAge(e.ts, now);
      lines.push(`  ${verb} ${e.subject ?? "?"} → ${e.outcome ?? "?"} (${age})`);
    }
  }

  return lines.join("\n");
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

function extractSubjectFromParams(name: string, params: Record<string, unknown>): string | null {
  switch (name) {
    case "write":
    case "edit":
      return typeof params.path === "string"
        ? params.path
        : typeof params.file === "string"
          ? params.file
          : null;
    case "exec":
      return typeof params.command === "string" ? params.command.slice(0, 80) : null;
    case "message":
      return typeof params.to === "string" ? params.to : null;
    case "sessions_spawn":
      return typeof params.task === "string" ? params.task.slice(0, 60) : null;
    case "sessions_send":
      return typeof params.sessionKey === "string" ? params.sessionKey : null;
    case "gateway":
      return typeof params.action === "string" ? params.action : null;
    default:
      return null;
  }
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
