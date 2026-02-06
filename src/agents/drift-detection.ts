/**
 * Drift Detection — RSC-inspired meta-cognitive monitoring.
 *
 * Tracks correction events per agent turn (fallbacks, retries, compactions,
 * thinking-level escalations) and detects degradation trends using a rolling
 * window with exponential decay weighting.
 *
 * When the correction rate exceeds a relative threshold (measured against the
 * session baseline), the system injects pressure signals into the next turn's
 * system prompt to encourage proactive recovery.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single correction event recorded at the end of an agent turn. */
export type CorrectionEvent = {
  /** Timestamp (ms) when the turn completed. */
  ts: number;
  /** Whether a model fallback was triggered during this turn. */
  modelFallback?: boolean;
  /** Whether tool retries exceeded 1 during this turn. */
  toolRetry?: boolean;
  /** Whether a forced compaction was triggered during this turn. */
  forcedCompaction?: boolean;
  /** Whether the thinking level was auto-escalated during this turn. */
  thinkingEscalation?: boolean;
  /** Whether a session reset occurred during this turn. */
  sessionReset?: boolean;
  /** Whether a context overflow was detected during this turn. */
  contextOverflow?: boolean;
};

export type DriftLevel = "normal" | "warning" | "drift" | "critical";

export type DriftState = {
  /** Rolling window of recent correction events (capped). */
  events: CorrectionEvent[];
  /** Measured baseline correction rate (set after calibration period). */
  baselineRate?: number;
  /** Number of turns observed for baseline calibration. */
  baselineTurns: number;
  /** Current computed drift level. */
  level: DriftLevel;
  /** Timestamp of last drift level change. */
  levelChangedAt?: number;
  /** Number of drift responses fired in this session. */
  driftResponseCount: number;
};

export type DriftPromptInjection = {
  level: DriftLevel;
  text: string;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum events in the rolling window. */
const MAX_WINDOW_SIZE = 50;

/** Minimum turns before baseline can be established. */
const BASELINE_CALIBRATION_TURNS = 20;

/** Exponential decay half-life in turns (more recent turns weigh more). */
const DECAY_HALF_LIFE_TURNS = 15;

/** Multiplier above baseline that triggers each level. */
const WARNING_MULTIPLIER = 2.0;
const DRIFT_MULTIPLIER = 3.0;
const CRITICAL_MULTIPLIER = 4.5;

/** Absolute floor rates (used when baseline is very low or zero). */
const WARNING_FLOOR_RATE = 0.2;
const DRIFT_FLOOR_RATE = 0.3;
const CRITICAL_FLOOR_RATE = 0.45;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isCorrection(event: CorrectionEvent): boolean {
  return !!(
    event.modelFallback ||
    event.toolRetry ||
    event.forcedCompaction ||
    event.thinkingEscalation ||
    event.sessionReset ||
    event.contextOverflow
  );
}

/**
 * Compute a weighted correction rate using exponential decay.
 * More recent events contribute more heavily.
 */
function computeWeightedRate(events: CorrectionEvent[]): number {
  if (events.length === 0) return 0;

  let weightedCorrections = 0;
  let totalWeight = 0;
  const ln2 = Math.LN2;

  for (let i = 0; i < events.length; i++) {
    // i=0 is oldest, i=length-1 is newest
    const recency = i; // higher = more recent
    const weight = Math.exp((ln2 * recency) / DECAY_HALF_LIFE_TURNS);
    totalWeight += weight;
    if (isCorrection(events[i]!)) {
      weightedCorrections += weight;
    }
  }

  return totalWeight > 0 ? weightedCorrections / totalWeight : 0;
}

function resolveThresholds(baselineRate: number | undefined): {
  warning: number;
  drift: number;
  critical: number;
} {
  if (baselineRate == null || baselineRate <= 0) {
    return {
      warning: WARNING_FLOOR_RATE,
      drift: DRIFT_FLOOR_RATE,
      critical: CRITICAL_FLOOR_RATE,
    };
  }
  return {
    warning: Math.max(WARNING_FLOOR_RATE, baselineRate * WARNING_MULTIPLIER),
    drift: Math.max(DRIFT_FLOOR_RATE, baselineRate * DRIFT_MULTIPLIER),
    critical: Math.max(CRITICAL_FLOOR_RATE, baselineRate * CRITICAL_MULTIPLIER),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function createInitialDriftState(): DriftState {
  return {
    events: [],
    baselineTurns: 0,
    level: "normal",
    driftResponseCount: 0,
  };
}

/**
 * Resolve drift state from session metadata fields.
 * Returns initial state if fields are missing/invalid.
 */
export function resolveDriftState(raw: {
  driftEvents?: unknown;
  driftBaselineRate?: unknown;
  driftBaselineTurns?: unknown;
  driftLevel?: unknown;
  driftLevelChangedAt?: unknown;
  driftResponseCount?: unknown;
}): DriftState {
  const events = Array.isArray(raw.driftEvents) ? (raw.driftEvents as CorrectionEvent[]) : [];
  const baselineRate =
    typeof raw.driftBaselineRate === "number" && Number.isFinite(raw.driftBaselineRate)
      ? raw.driftBaselineRate
      : undefined;
  const baselineTurns =
    typeof raw.driftBaselineTurns === "number" && raw.driftBaselineTurns > 0
      ? Math.floor(raw.driftBaselineTurns)
      : 0;
  const level = (() => {
    const v = raw.driftLevel;
    if (v === "warning" || v === "drift" || v === "critical") return v;
    return "normal" as const;
  })();
  const levelChangedAt =
    typeof raw.driftLevelChangedAt === "number" && Number.isFinite(raw.driftLevelChangedAt)
      ? Math.floor(raw.driftLevelChangedAt)
      : undefined;
  const driftResponseCount =
    typeof raw.driftResponseCount === "number" && raw.driftResponseCount > 0
      ? Math.floor(raw.driftResponseCount)
      : 0;

  return {
    events: events.slice(-MAX_WINDOW_SIZE),
    baselineRate,
    baselineTurns,
    level,
    levelChangedAt,
    driftResponseCount,
  };
}

/**
 * Record a new turn and update drift state.
 * Returns the updated state and whether the level changed.
 */
export function recordTurnOutcome(
  state: DriftState,
  event: CorrectionEvent,
): { next: DriftState; levelChanged: boolean; previousLevel: DriftLevel } {
  const now = event.ts || Date.now();
  const previousLevel = state.level;

  // Append event, cap window
  const events = [...state.events, event].slice(-MAX_WINDOW_SIZE);
  const baselineTurns = state.baselineTurns + 1;

  // Calibrate baseline after enough turns
  let baselineRate = state.baselineRate;
  if (baselineRate == null && baselineTurns >= BASELINE_CALIBRATION_TURNS) {
    baselineRate = computeWeightedRate(events);
  }

  // Compute current rate and level
  const currentRate = computeWeightedRate(events);
  const thresholds = resolveThresholds(baselineRate);

  let level: DriftLevel = "normal";
  if (currentRate >= thresholds.critical) {
    level = "critical";
  } else if (currentRate >= thresholds.drift) {
    level = "drift";
  } else if (currentRate >= thresholds.warning) {
    level = "warning";
  }

  const levelChanged = level !== previousLevel;
  const driftResponseCount =
    levelChanged && level !== "normal" ? state.driftResponseCount + 1 : state.driftResponseCount;

  return {
    next: {
      events,
      baselineRate,
      baselineTurns,
      level,
      levelChangedAt: levelChanged ? now : state.levelChangedAt,
      driftResponseCount,
    },
    levelChanged,
    previousLevel,
  };
}

/**
 * Build a system prompt injection based on current drift level.
 * Returns null if no injection is needed (level is "normal").
 */
export function buildDriftPromptInjection(state: DriftState): DriftPromptInjection | null {
  switch (state.level) {
    case "warning":
      return {
        level: "warning",
        text: [
          "## Stability Notice",
          "Recent turns show elevated correction activity (model fallbacks, retries, or compactions).",
          "Before proceeding with complex actions: briefly summarize current state and progress so far.",
          "Prefer simpler approaches over multi-step operations until stability improves.",
        ].join("\n"),
      };
    case "drift":
      return {
        level: "drift",
        text: [
          "## Stability Warning",
          "Degradation trend detected: correction rate is significantly above baseline.",
          "Before taking action: ask a clarifying question or confirm your understanding of the current goal.",
          "Avoid starting new multi-step operations. Focus on completing or checkpointing current work.",
          "If uncertain about any assumption, state it explicitly before proceeding.",
        ].join("\n"),
      };
    case "critical":
      return {
        level: "critical",
        text: [
          "## Critical Stability Alert",
          "Persistent degradation detected across multiple recent turns.",
          "REQUIRED: Summarize all current progress and open questions before taking any further action.",
          "Do not start new operations. Ask the user to confirm next steps.",
          "If context feels degraded or unclear, suggest starting a fresh session with a summary.",
        ].join("\n"),
      };
    default:
      return null;
  }
}

/**
 * Format a human-readable drift status summary for CLI output.
 */
export function formatDriftStatus(state: DriftState): string {
  const totalTurns = state.events.length;
  const corrections = state.events.filter(isCorrection).length;
  const rate = computeWeightedRate(state.events);
  const thresholds = resolveThresholds(state.baselineRate);

  const lines: string[] = [
    `Drift Level: ${state.level.toUpperCase()}`,
    `Turns in window: ${totalTurns}/${MAX_WINDOW_SIZE}`,
    `Raw corrections: ${corrections}/${totalTurns}`,
    `Weighted rate: ${(rate * 100).toFixed(1)}%`,
    `Baseline: ${state.baselineRate != null ? `${(state.baselineRate * 100).toFixed(1)}%` : `calibrating (${state.baselineTurns}/${BASELINE_CALIBRATION_TURNS} turns)`}`,
    `Thresholds: warning=${(thresholds.warning * 100).toFixed(0)}% drift=${(thresholds.drift * 100).toFixed(0)}% critical=${(thresholds.critical * 100).toFixed(0)}%`,
    `Drift responses fired: ${state.driftResponseCount}`,
  ];

  if (state.levelChangedAt) {
    const ago = Date.now() - state.levelChangedAt;
    const mins = Math.floor(ago / 60_000);
    lines.push(`Last level change: ${mins}m ago`);
  }

  // Breakdown of correction types
  const breakdown = {
    modelFallback: 0,
    toolRetry: 0,
    forcedCompaction: 0,
    thinkingEscalation: 0,
    sessionReset: 0,
    contextOverflow: 0,
  };
  for (const event of state.events) {
    if (event.modelFallback) breakdown.modelFallback++;
    if (event.toolRetry) breakdown.toolRetry++;
    if (event.forcedCompaction) breakdown.forcedCompaction++;
    if (event.thinkingEscalation) breakdown.thinkingEscalation++;
    if (event.sessionReset) breakdown.sessionReset++;
    if (event.contextOverflow) breakdown.contextOverflow++;
  }
  const parts = Object.entries(breakdown)
    .filter(([, count]) => count > 0)
    .map(([key, count]) => `${key}=${count}`);
  if (parts.length > 0) {
    lines.push(`Breakdown: ${parts.join(", ")}`);
  }

  return lines.join("\n");
}
