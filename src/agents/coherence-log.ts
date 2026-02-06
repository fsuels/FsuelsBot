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
 *
 * Design principle: Event memory exists to support judgment, not
 * explanation. The system records what happened to inform future
 * decisions — it does not narrate or justify past behavior.
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

// TODO(v3.2): Add a unique `id` field (e.g. nanoid) to CoherenceEntry.
// Current deduplication relies on ts + summary, which is brittle under
// sub-millisecond concurrency. Tracked as tech debt — not blocking.

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
// RSC v3.1 — Verb Taxonomy Analysis types
// ---------------------------------------------------------------------------

/** Current taxonomy schema version. Bump only on human-approved changes. */
export const VERB_TAXONOMY_VERSION = 1;

/** Hard cap on total verbs allowed. */
const MAX_VERB_COUNT = 10;

/** Analysis result for a single verb. */
export type VerbAnalysis = {
  verb: string;
  count: number;
  /** Shannon entropy of subject values (bits). */
  subjectEntropy: number;
  /** Shannon entropy of outcome values (bits). */
  outcomeEntropy: number;
  /** Diagnostic classification. */
  diagnostic: "normal" | "too-broad" | "low-information";
};

export type VerbCoOccurrence = {
  verbA: string;
  verbB: string;
  /** Fraction of turn-windows where both verbs appear (0-1). */
  coOccurrenceRate: number;
};

export type TaxonomySuggestion = {
  kind: "split" | "add" | "redundant";
  description: string;
  evidence: string;
};

export type VerbTaxonomyReport = {
  analyses: VerbAnalysis[];
  coOccurrences: VerbCoOccurrence[];
  suggestions: TaxonomySuggestion[];
};

// ---------------------------------------------------------------------------
// RSC v3.1 — Trust Accumulation types
// ---------------------------------------------------------------------------

export type TrustTier = "new" | "emerging" | "established" | "proven";

export type TrustSignals = {
  tier: TrustTier;
  totalEvents: number;
  positiveSignals: number;
  negativeSignals: number;
  /** DECIDED events not followed by REJECTED on same subject within 5 turns. */
  decisionsHeld: number;
  /** FAILED followed by CHANGED on same subject within 3 turns. */
  failuresRecovered: number;
  /** BLOCKED followed by different approach within 2 turns. */
  blocksSurfacedEarly: number;
  /** DECIDED then REJECTED on same subject. */
  contradictions: number;
  /** Same FAILED pattern 3+ times. */
  repeatedFailures: number;
  /** Total ESCALATED events. */
  escalations: number;
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
// RSC v3.1-patch — User Correction Detection
// ---------------------------------------------------------------------------

/** Max user message length to consider for correction detection. */
const USER_CORRECTION_MAX_LENGTH = 200;

/** Patterns that indicate the user is correcting/rejecting previous agent behavior. */
const USER_CORRECTION_PATTERNS = [
  /\b(no|nope|wrong|incorrect|undo|revert|rollback|go back|start over|that'?s not)\b/i,
  /\b(don'?t|stop|cancel|abort|never mind|nevermind)\b/i,
  /\b(actually|instead|rather|not what I)\b/i,
];

/**
 * Detect whether a user message contains correction language.
 * Short messages (<200 chars) matching correction patterns are treated
 * as intent corrections. Longer messages are assumed to be new instructions
 * that happen to contain negation words.
 */
export function isUserCorrection(message: string): boolean {
  if (!message || message.length > USER_CORRECTION_MAX_LENGTH) return false;
  return USER_CORRECTION_PATTERNS.some((p) => p.test(message));
}

/**
 * Build a REJECTED coherence entry from a user correction.
 */
export function buildUserCorrectionEntry(params: {
  messagePreview: string;
  taskId?: string;
  now?: number;
}): CoherenceEntry {
  const now = params.now ?? Date.now();
  const preview = params.messagePreview.slice(0, 60);
  return {
    ts: now,
    source: "session_reset",
    summary: `REJECTED user correction → ${preview}`,
    taskId: params.taskId,
    verb: EventVerb.REJECTED,
    subject: "user correction",
    outcome: preview,
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
// RSC v3.1 — Verb Taxonomy Analysis
// ---------------------------------------------------------------------------

/** Threshold: verb is "too broad" if it has >60% of events AND subject entropy >2.0 bits. */
const TOO_BROAD_FREQUENCY_RATIO = 0.6;
const TOO_BROAD_ENTROPY_THRESHOLD = 2.0;

/** Threshold: verb is "low information" if outcome entropy < 0.1 bits (all same outcome). */
const LOW_INFO_OUTCOME_ENTROPY = 0.1;

/** Threshold: two verbs are "redundant" if co-occurrence > 0.8. */
const REDUNDANT_CO_OCCURRENCE = 0.8;

/** Window (ms) for grouping events into turn windows for co-occurrence. */
const CO_OCCURRENCE_WINDOW_MS = 2000;

/** Patterns in CHANGED outcomes that suggest a missing verb. */
const ANOMALOUS_OUTCOME_PATTERNS = /revert|undo|rollback|timeout|error/i;

/** Minimum anomalous outcomes to suggest a new verb. */
const ANOMALOUS_SUGGESTION_THRESHOLD = 5;

/**
 * Analyze the verb taxonomy health from a set of coherence entries.
 * Pure function. Read-only — never modifies the taxonomy.
 */
export function analyzeVerbTaxonomy(entries: CoherenceEntry[]): VerbTaxonomyReport {
  const structured = entries.filter(isStructuredEvent);
  if (structured.length === 0) {
    return { analyses: [], coOccurrences: [], suggestions: [] };
  }

  const totalCount = structured.length;

  // Group entries by verb
  const byVerb = new Map<string, CoherenceEntry[]>();
  for (const e of structured) {
    const list = byVerb.get(e.verb) ?? [];
    list.push(e);
    byVerb.set(e.verb, list);
  }

  // Compute per-verb analysis
  const analyses: VerbAnalysis[] = [];
  for (const [verb, events] of byVerb) {
    const count = events.length;
    const subjects = events.map((e) => e.subject ?? "").filter(Boolean);
    const outcomes = events.map((e) => e.outcome ?? "").filter(Boolean);
    const subjectEntropy = shannonEntropy(subjects);
    const outcomeEntropy = shannonEntropy(outcomes);

    const frequencyRatio = count / totalCount;
    let diagnostic: VerbAnalysis["diagnostic"] = "normal";
    if (
      frequencyRatio > TOO_BROAD_FREQUENCY_RATIO &&
      subjectEntropy > TOO_BROAD_ENTROPY_THRESHOLD
    ) {
      diagnostic = "too-broad";
    } else if (outcomeEntropy < LOW_INFO_OUTCOME_ENTROPY && count >= 5) {
      diagnostic = "low-information";
    }

    analyses.push({ verb, count, subjectEntropy, outcomeEntropy, diagnostic });
  }

  // Sort by count descending
  analyses.sort((a, b) => b.count - a.count);

  // Compute co-occurrence in turn windows
  const coOccurrences: VerbCoOccurrence[] = [];
  const windows = groupIntoTurnWindows(structured, CO_OCCURRENCE_WINDOW_MS);
  if (windows.length >= 3) {
    const verbs = [...byVerb.keys()];
    for (let i = 0; i < verbs.length; i++) {
      for (let j = i + 1; j < verbs.length; j++) {
        const verbA = verbs[i]!;
        const verbB = verbs[j]!;
        let both = 0;
        let either = 0;
        for (const win of windows) {
          const hasA = win.some((e) => e.verb === verbA);
          const hasB = win.some((e) => e.verb === verbB);
          if (hasA || hasB) either++;
          if (hasA && hasB) both++;
        }
        if (either > 0) {
          const rate = both / either;
          if (rate > 0.3) {
            coOccurrences.push({ verbA, verbB, coOccurrenceRate: rate });
          }
        }
      }
    }
    coOccurrences.sort((a, b) => b.coOccurrenceRate - a.coOccurrenceRate);
  }

  // Generate suggestions
  const suggestions: TaxonomySuggestion[] = [];

  // Check for too-broad verbs
  for (const a of analyses) {
    if (a.diagnostic === "too-broad") {
      suggestions.push({
        kind: "split",
        description: `${a.verb} is too broad (${a.count} events, subject entropy ${a.subjectEntropy.toFixed(1)} bits)`,
        evidence: `${a.count}/${totalCount} events (${((a.count / totalCount) * 100).toFixed(0)}%) with high subject diversity`,
      });
    }
  }

  // Check for redundant verb pairs
  for (const co of coOccurrences) {
    if (co.coOccurrenceRate > REDUNDANT_CO_OCCURRENCE) {
      suggestions.push({
        kind: "redundant",
        description: `${co.verbA} and ${co.verbB} co-occur ${(co.coOccurrenceRate * 100).toFixed(0)}% of the time`,
        evidence: `High co-occurrence suggests these verbs may be indistinguishable`,
      });
    }
  }

  // Check for missing verbs via anomalous CHANGED outcomes
  const changedEvents = byVerb.get(EventVerb.CHANGED) ?? [];
  const anomalous = changedEvents.filter(
    (e) => e.outcome && ANOMALOUS_OUTCOME_PATTERNS.test(e.outcome),
  );
  if (anomalous.length >= ANOMALOUS_SUGGESTION_THRESHOLD) {
    // Group by matching pattern
    const patterns = new Map<string, number>();
    for (const e of anomalous) {
      const match = e.outcome?.match(ANOMALOUS_OUTCOME_PATTERNS)?.[0]?.toLowerCase() ?? "unknown";
      patterns.set(match, (patterns.get(match) ?? 0) + 1);
    }
    for (const [pattern, count] of patterns) {
      if (count >= ANOMALOUS_SUGGESTION_THRESHOLD) {
        suggestions.push({
          kind: "add",
          description: `Consider adding verb for "${pattern}" — ${count} CHANGED events have this outcome pattern`,
          evidence: `${count} events with outcome matching "${pattern}"`,
        });
      }
    }
  }

  // Check for FAILED→same-subject CHANGED (retry pattern)
  let retryCount = 0;
  for (let i = 0; i < structured.length; i++) {
    const e = structured[i]!;
    if (e.verb !== EventVerb.FAILED) continue;
    for (let j = i + 1; j < Math.min(i + 3, structured.length); j++) {
      const next = structured[j]!;
      if (next.verb === EventVerb.CHANGED && next.subject === e.subject) {
        retryCount++;
        break;
      }
    }
  }
  if (retryCount >= ANOMALOUS_SUGGESTION_THRESHOLD) {
    suggestions.push({
      kind: "add",
      description: `Consider adding RETRIED — ${retryCount} FAILED events followed by same-subject CHANGED within 2 turns`,
      evidence: `${retryCount} retry patterns detected`,
    });
  }

  return { analyses, coOccurrences, suggestions };
}

/**
 * Format verb taxonomy report for CLI display.
 */
export function formatVerbTaxonomyReport(report: VerbTaxonomyReport): string {
  if (report.analyses.length === 0) {
    return "Verb Taxonomy: no structured events to analyze";
  }

  const lines: string[] = [
    `Verb Taxonomy Health (v${VERB_TAXONOMY_VERSION}, ${Object.keys(EventVerb).length}/${MAX_VERB_COUNT} verbs):`,
  ];

  for (const a of report.analyses) {
    const icon = a.diagnostic === "normal" ? "ok" : "! ";
    const detail =
      a.diagnostic === "too-broad"
        ? `subject entropy ${a.subjectEntropy.toFixed(1)} (too-broad)`
        : a.diagnostic === "low-information"
          ? `outcome entropy ${a.outcomeEntropy.toFixed(1)} (low-information)`
          : "stable";
    lines.push(`  ${icon} ${a.verb}: ${a.count} events, ${detail}`);
  }

  if (report.suggestions.length > 0) {
    lines.push("");
    for (const s of report.suggestions) {
      lines.push(`  Suggestion [${s.kind}]: ${s.description}`);
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// RSC v3.1 — Trust Accumulation
// ---------------------------------------------------------------------------

/**
 * Compute trust signals from structured event history.
 * Pure function, single pass. Evaluates decisions held, failures recovered, etc.
 */
export function computeTrustSignals(events: CoherenceEntry[]): TrustSignals {
  const structured = events.filter(isStructuredEvent);

  let decisionsHeld = 0;
  let failuresRecovered = 0;
  let blocksSurfacedEarly = 0;
  let contradictions = 0;
  let escalations = 0;

  // Track repeated failure subjects
  const failedSubjects = new Map<string, number>();

  for (let i = 0; i < structured.length; i++) {
    const e = structured[i]!;

    if (e.verb === EventVerb.DECIDED) {
      // Check if this decision held (no REJECTED on same subject within 5 events)
      let rejected = false;
      for (let j = i + 1; j < Math.min(i + 6, structured.length); j++) {
        const next = structured[j]!;
        if (next.verb === EventVerb.REJECTED && next.subject === e.subject) {
          rejected = true;
          break;
        }
      }
      if (rejected) contradictions++;
      else decisionsHeld++;
    }

    if (e.verb === EventVerb.FAILED) {
      // Track for repeated failures
      const key = `${e.subject}:${e.outcome}`;
      failedSubjects.set(key, (failedSubjects.get(key) ?? 0) + 1);

      // Check if this failure was recovered (CHANGED on same subject within 3 events)
      for (let j = i + 1; j < Math.min(i + 4, structured.length); j++) {
        const next = structured[j]!;
        if (next.verb === EventVerb.CHANGED && next.subject === e.subject) {
          failuresRecovered++;
          break;
        }
      }
    }

    if (e.verb === EventVerb.BLOCKED) {
      // Check if block was surfaced early (different approach within 2 events)
      for (let j = i + 1; j < Math.min(i + 3, structured.length); j++) {
        const next = structured[j]!;
        if (
          (next.verb === EventVerb.CHANGED || next.verb === EventVerb.DECIDED) &&
          next.subject !== e.subject
        ) {
          blocksSurfacedEarly++;
          break;
        }
      }
    }

    if (e.verb === EventVerb.ESCALATED) {
      escalations++;
    }
  }

  // Count repeated failure groups
  let repeatedFailures = 0;
  for (const count of failedSubjects.values()) {
    if (count >= 3) repeatedFailures++;
  }

  const positiveSignals = decisionsHeld + failuresRecovered + blocksSurfacedEarly;
  const negativeSignals = contradictions + repeatedFailures + escalations;

  const tier = resolveTrustTier({
    totalEvents: structured.length,
    decisionsHeld,
    failuresRecovered,
    contradictions,
    positiveSignals,
    negativeSignals,
  });

  return {
    tier,
    totalEvents: structured.length,
    positiveSignals,
    negativeSignals,
    decisionsHeld,
    failuresRecovered,
    blocksSurfacedEarly,
    contradictions,
    repeatedFailures,
    escalations,
  };
}

function resolveTrustTier(s: {
  totalEvents: number;
  decisionsHeld: number;
  failuresRecovered: number;
  contradictions: number;
  positiveSignals: number;
  negativeSignals: number;
}): TrustTier {
  if (
    s.totalEvents >= 100 &&
    s.decisionsHeld >= 30 &&
    s.negativeSignals > 0 &&
    s.positiveSignals / s.negativeSignals > 3
  ) {
    return "proven";
  }
  if (
    s.totalEvents >= 30 &&
    s.decisionsHeld >= 10 &&
    s.failuresRecovered >= 3 &&
    s.contradictions < 5
  ) {
    return "established";
  }
  if (s.totalEvents >= 10 && s.decisionsHeld >= 3 && s.contradictions < 3) {
    return "emerging";
  }
  return "new";
}

/**
 * Format trust status for CLI display.
 */
export function formatTrustStatus(signals: TrustSignals): string {
  const lines: string[] = [
    `Trust: ${signals.tier} (${signals.totalEvents} events, ${signals.decisionsHeld} decisions held, ${signals.failuresRecovered} failures recovered)`,
  ];
  lines.push(
    `  Positive: ${signals.positiveSignals} (${signals.decisionsHeld} held, ${signals.failuresRecovered} recovered, ${signals.blocksSurfacedEarly} early blocks)`,
  );
  lines.push(
    `  Negative: ${signals.negativeSignals} (${signals.contradictions} contradictions, ${signals.repeatedFailures} repeated failures, ${signals.escalations} escalations)`,
  );
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// RSC v3.1 — Cross-Session Event Promotion
// ---------------------------------------------------------------------------

import type { PromotedEvent, PromotionCandidate } from "../config/sessions/types.js";

/** Max promoted events per agent-level session. */
const MAX_PROMOTED_EVENTS = 10;
/** Max promotion candidates tracked. */
const MAX_PROMOTION_CANDIDATES = 30;
/** Sessions required for promotion (standard). */
const PROMOTION_SESSION_THRESHOLD = 3;
/** Sessions required for pinned promotion. */
const PROMOTION_PINNED_THRESHOLD = 2;
/** Promoted events expire after 14 days without reinforcement. */
const PROMOTION_RETIRE_MS = 14 * 24 * 60 * 60 * 1000;
/** Candidate observations must be within this window. */
const PROMOTION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** Only these verbs are promotion-eligible. */
const PROMOTION_ELIGIBLE_VERBS = new Set<EventVerb>([
  EventVerb.FAILED,
  EventVerb.DECIDED,
  EventVerb.BLOCKED,
]);

/** Max promoted event lines to inject in pre-turn prompt. */
const MAX_PROMOTED_INJECTION_LINES = 3;

/**
 * Evaluate session events for promotion to the parent/agent-level session.
 * Updates candidates and promotes when thresholds are met.
 */
export function evaluatePromotionCandidates(params: {
  sessionKey: string;
  events: CoherenceEntry[];
  pinned: CoherenceEntry[];
  existingCandidates: PromotionCandidate[];
  existingPromoted: PromotedEvent[];
  now?: number;
}): { candidates: PromotionCandidate[]; promoted: PromotedEvent[] } {
  const now = params.now ?? Date.now();
  const windowStart = now - PROMOTION_WINDOW_MS;

  // Start with copies
  let candidates = [...params.existingCandidates];
  let promoted = pruneRetiredPromotedEvents(params.existingPromoted, now);

  // Extract promotion-eligible structured events from this session
  const eligible = params.events
    .filter(isStructuredEvent)
    .filter((e) => PROMOTION_ELIGIBLE_VERBS.has(e.verb));

  // Also check pinned entries
  const pinnedEligible = params.pinned
    .filter(isStructuredEvent)
    .filter((e) => PROMOTION_ELIGIBLE_VERBS.has(e.verb));

  // Process each eligible event
  const processedKeys = new Set<string>();
  for (const e of [...eligible, ...pinnedEligible]) {
    const key = `${e.verb}:${e.subject}:${e.outcome}`;
    if (processedKeys.has(key)) continue;
    processedKeys.add(key);

    // Check if already promoted — reinforce if so
    const existingPromoted = promoted.find(
      (p) => p.verb === e.verb && p.subject === e.subject && p.outcome === e.outcome,
    );
    if (existingPromoted) {
      existingPromoted.occurrences++;
      existingPromoted.lastSeenTs = now;
      existingPromoted.retireAfterTs = now + PROMOTION_RETIRE_MS;
      if (!existingPromoted.sourceSessionKeys.includes(params.sessionKey)) {
        existingPromoted.sourceSessionKeys.push(params.sessionKey);
      }
      continue;
    }

    // Find or create candidate
    let candidate = candidates.find(
      (c) => c.verb === e.verb && c.subject === e.subject && c.outcome === e.outcome,
    );
    if (!candidate) {
      candidate = {
        verb: e.verb,
        subject: e.subject ?? "",
        outcome: e.outcome ?? "",
        seenInSessions: [],
        seenTimestamps: [],
      };
      candidates.push(candidate);
    }

    // Add this session if not already tracked
    if (!candidate.seenInSessions.includes(params.sessionKey)) {
      candidate.seenInSessions.push(params.sessionKey);
      candidate.seenTimestamps.push(now);
    }

    // Prune old observations outside window
    candidate.seenTimestamps = candidate.seenTimestamps.filter((ts) => ts >= windowStart);
    candidate.seenInSessions = candidate.seenInSessions.slice(-candidate.seenTimestamps.length);

    // Check promotion threshold
    const isPinned = pinnedEligible.some((p) => p.verb === e.verb && p.subject === e.subject);
    const threshold = isPinned ? PROMOTION_PINNED_THRESHOLD : PROMOTION_SESSION_THRESHOLD;

    if (candidate.seenInSessions.length >= threshold && promoted.length < MAX_PROMOTED_EVENTS) {
      // Promote!
      promoted.push({
        verb: candidate.verb as EventVerb,
        subject: candidate.subject,
        outcome: candidate.outcome,
        occurrences: candidate.seenInSessions.length,
        firstSeenTs: candidate.seenTimestamps[0] ?? now,
        lastSeenTs: now,
        sourceSessionKeys: [...candidate.seenInSessions],
        retireAfterTs: now + PROMOTION_RETIRE_MS,
      });
      // Remove from candidates
      candidates = candidates.filter(
        (c) =>
          !(
            c.verb === candidate!.verb &&
            c.subject === candidate!.subject &&
            c.outcome === candidate!.outcome
          ),
      );
    }
  }

  // Cap candidates
  if (candidates.length > MAX_PROMOTION_CANDIDATES) {
    candidates.sort((a, b) => {
      const aTs = a.seenTimestamps[0] ?? 0;
      const bTs = b.seenTimestamps[0] ?? 0;
      return bTs - aTs;
    });
    candidates = candidates.slice(0, MAX_PROMOTION_CANDIDATES);
  }

  return { candidates, promoted };
}

/**
 * Remove promoted events that have expired (retireAfterTs passed).
 */
export function pruneRetiredPromotedEvents(events: PromotedEvent[], now?: number): PromotedEvent[] {
  const ts = now ?? Date.now();
  return events.filter((e) => e.retireAfterTs > ts);
}

/**
 * Format promoted events for pre-turn system prompt injection.
 * Returns null if no promoted events to inject.
 */
export function formatPromotedEventsInjection(
  events: PromotedEvent[],
  now?: number,
): string | null {
  const active = pruneRetiredPromotedEvents(events, now);
  if (active.length === 0) return null;

  const lines: string[] = ["## Cross-Session Memory"];
  const shown = active.slice(0, MAX_PROMOTED_INJECTION_LINES);
  for (const e of shown) {
    const verb = e.verb.toUpperCase();
    lines.push(
      `- In previous sessions: ${verb} ${e.subject} → ${e.outcome} (seen ${e.occurrences} times)`,
    );
  }

  return lines.join("\n");
}

/**
 * Format promoted events and candidates for CLI display.
 */
export function formatPromotedEventsStatus(
  events: PromotedEvent[],
  candidates: PromotionCandidate[],
): string {
  const lines: string[] = [];

  if (events.length === 0 && candidates.length === 0) {
    return "Cross-Session Promotion: no promoted events or candidates";
  }

  if (events.length > 0) {
    lines.push(`Promoted Events (${events.length}/${MAX_PROMOTED_EVENTS}):`);
    for (const e of events) {
      const daysLeft = Math.max(
        0,
        Math.floor((e.retireAfterTs - Date.now()) / (24 * 60 * 60 * 1000)),
      );
      lines.push(
        `  ${e.verb.toUpperCase()} ${e.subject} → ${e.outcome} (${e.occurrences} occurrences across ${e.sourceSessionKeys.length} sessions, retires in ${daysLeft}d)`,
      );
    }
  }

  if (candidates.length > 0) {
    lines.push(`Promotion Candidates (${candidates.length}/${MAX_PROMOTION_CANDIDATES}):`);
    for (const c of candidates.slice(0, 5)) {
      lines.push(
        `  ${c.verb.toUpperCase()} ${c.subject} → ${c.outcome} (${c.seenInSessions.length}/${PROMOTION_SESSION_THRESHOLD} sessions toward promotion)`,
      );
    }
    if (candidates.length > 5) {
      lines.push(`  ... and ${candidates.length - 5} more candidates`);
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Shannon entropy in bits.
 */
function shannonEntropy(values: string[]): number {
  if (values.length === 0) return 0;
  const freq = new Map<string, number>();
  for (const v of values) freq.set(v, (freq.get(v) ?? 0) + 1);
  let h = 0;
  for (const count of freq.values()) {
    const p = count / values.length;
    if (p > 0) h -= p * Math.log2(p);
  }
  return h;
}

/**
 * Group events into turn windows (events within windowMs of each other).
 */
function groupIntoTurnWindows(events: CoherenceEntry[], windowMs: number): CoherenceEntry[][] {
  if (events.length === 0) return [];
  const sorted = [...events].sort((a, b) => a.ts - b.ts);
  const windows: CoherenceEntry[][] = [];
  let current: CoherenceEntry[] = [sorted[0]!];

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.ts - sorted[i - 1]!.ts <= windowMs) {
      current.push(sorted[i]!);
    } else {
      windows.push(current);
      current = [sorted[i]!];
    }
  }
  windows.push(current);
  return windows;
}

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
