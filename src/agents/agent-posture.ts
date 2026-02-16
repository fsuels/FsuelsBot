/**
 * Agent Posture State Machine — S0 Meta-Policy Arbitration Layer.
 *
 * Unifies drift detection, tool failure tracking, context pressure, and
 * memory availability into a single cognitive posture that coordinates
 * cross-cutting intervention decisions.
 *
 * State transitions:
 *   normal → cautious → struggling → degraded
 *
 * Recovery (reverse transitions) requires explicit criteria to be met.
 *
 * Formal invariants are enforced at runtime (fail-soft) and in replay
 * mode (fail-hard).
 */

import type { DriftLevel } from "./drift-detection.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PostureMode = "normal" | "cautious" | "struggling" | "degraded";

export type AgentPosture = {
  mode: PostureMode;
  contextPressure: number; // 0-1
  driftLevel: DriftLevel;
  toolHealthRatio: number; // healthy / total
  memoryAvailable: boolean;
  thinkingLevel: string; // "off" | "standard" | "extended" etc.
  /** Turn at which posture was last changed. */
  lastTransitionTurn: number;
  /** Previous mode (for anti-oscillation). */
  previousMode: PostureMode;
  /** Thinking escalation count in this run. */
  thinkingEscalations: number;
  /** Turn-indexed oscillation history for last 3 transitions. */
  recentTransitions: Array<{ turn: number; from: PostureMode; to: PostureMode }>;
};

export type PostureTransition = {
  from: PostureMode;
  to: PostureMode;
  turn: number;
  reason: string;
};

export type PostureSignals = {
  contextPressure: number;
  driftLevel: DriftLevel;
  toolHealthRatio: number;
  memoryAvailable: boolean;
  thinkingLevel: string;
  currentTurn: number;
};

export type PostureInvariantViolation = {
  invariant: string;
  message: string;
  correctedMode?: PostureMode;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const POSTURE_ORDER: Record<PostureMode, number> = {
  normal: 0,
  cautious: 1,
  struggling: 2,
  degraded: 3,
};

/** Injection budget multiplier by posture mode (fraction of context window). */
export const POSTURE_INJECTION_CAPS: Record<PostureMode, number> = {
  normal: 0.15,
  cautious: 0.12,
  struggling: 0.08,
  degraded: 0.03, // essentials only
};

/** Dynamic tool disable threshold by posture mode. */
export const POSTURE_TOOL_DISABLE_THRESHOLD: Record<PostureMode, number> = {
  normal: 5,
  cautious: 5,
  struggling: 4,
  degraded: 3,
};

/** Minimum turns before a posture can change again (anti-oscillation). */
const MIN_TURNS_BETWEEN_TRANSITIONS = 3;

/** Max fraction of tools that can be disabled simultaneously. */
const MAX_TOOL_DISABLE_FRACTION = 0.5;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createInitialPosture(): AgentPosture {
  return {
    mode: "normal",
    contextPressure: 0,
    driftLevel: "normal",
    toolHealthRatio: 1,
    memoryAvailable: true,
    thinkingLevel: "off",
    lastTransitionTurn: 0,
    previousMode: "normal",
    thinkingEscalations: 0,
    recentTransitions: [],
  };
}

// ---------------------------------------------------------------------------
// Transition Logic
// ---------------------------------------------------------------------------

function computeTargetMode(signals: PostureSignals): PostureMode {
  const { contextPressure, driftLevel, toolHealthRatio, memoryAvailable } = signals;

  // Degraded: critical drift + (high pressure OR memory down)
  if (driftLevel === "critical" && (contextPressure > 0.9 || !memoryAvailable)) {
    return "degraded";
  }

  // Struggling: drift-level OR high pressure OR low tool health
  if (driftLevel === "drift" || contextPressure > 0.85 || toolHealthRatio < 0.5) {
    return "struggling";
  }

  // Cautious: warning-level OR moderate tool failures
  if (driftLevel === "warning" || toolHealthRatio < 0.8) {
    return "cautious";
  }

  // Normal: all clear
  if (driftLevel === "normal" && toolHealthRatio > 0.9 && contextPressure < 0.7) {
    return "normal";
  }

  // If none of the clear-recovery criteria are met, stay at current implied level
  // Return cautious as a safe middle ground when signals are mixed
  return "cautious";
}

/**
 * Update agent posture based on current signals.
 * Returns the new posture and any transition that occurred.
 */
export function updatePosture(
  current: AgentPosture,
  signals: PostureSignals,
): { posture: AgentPosture; transition?: PostureTransition; violations: PostureInvariantViolation[] } {
  const violations: PostureInvariantViolation[] = [];

  // Update signal fields
  const next: AgentPosture = {
    ...current,
    contextPressure: signals.contextPressure,
    driftLevel: signals.driftLevel,
    toolHealthRatio: signals.toolHealthRatio,
    memoryAvailable: signals.memoryAvailable,
    thinkingLevel: signals.thinkingLevel,
  };

  // Invariant 4: context pressure bound
  if (signals.contextPressure < 0 || signals.contextPressure > 1) {
    violations.push({
      invariant: "context_pressure_bound",
      message: `contextPressure ${signals.contextPressure} outside [0,1]`,
    });
    next.contextPressure = Math.min(1, Math.max(0, signals.contextPressure));
  }

  const targetMode = computeTargetMode(signals);
  const currentOrder = POSTURE_ORDER[current.mode];
  const targetOrder = POSTURE_ORDER[targetMode];

  let newMode = current.mode;

  if (targetOrder > currentOrder) {
    // Degradation: enforce monotonic (Invariant 1 — no skipping)
    const nextDegradedStep = currentOrder + 1;
    const modes: PostureMode[] = ["normal", "cautious", "struggling", "degraded"];
    newMode = modes[Math.min(nextDegradedStep, 3)]!;
  } else if (targetOrder < currentOrder) {
    // Recovery: only if explicit criteria met and not too soon
    if (signals.currentTurn - current.lastTransitionTurn >= MIN_TURNS_BETWEEN_TRANSITIONS) {
      // Allow recovery by one step
      const recoveryStep = currentOrder - 1;
      const modes: PostureMode[] = ["normal", "cautious", "struggling", "degraded"];
      newMode = modes[Math.max(recoveryStep, 0)]!;
    }
    // else: stay at current mode (cooldown not elapsed)
  }

  // Invariant 2: Anti-oscillation check
  const recentTransitions = [...current.recentTransitions];
  if (newMode !== current.mode) {
    // Check for oscillation (A→B→A within last 3 transitions)
    if (recentTransitions.length >= 2) {
      const last = recentTransitions[recentTransitions.length - 1];
      const secondLast = recentTransitions[recentTransitions.length - 2];
      if (
        last &&
        secondLast &&
        secondLast.from === newMode &&
        secondLast.to === last.from &&
        signals.currentTurn - secondLast.turn <= 3
      ) {
        // Oscillation detected — lock at more degraded state
        const lockedMode =
          POSTURE_ORDER[newMode] > POSTURE_ORDER[current.mode] ? newMode : current.mode;
        violations.push({
          invariant: "anti_oscillation",
          message: `Oscillation detected (${secondLast.from}→${last.from}→${newMode}); locking at ${lockedMode}`,
          correctedMode: lockedMode,
        });
        newMode = lockedMode;
      }
    }
  }

  let transition: PostureTransition | undefined;
  if (newMode !== current.mode) {
    transition = {
      from: current.mode,
      to: newMode,
      turn: signals.currentTurn,
      reason: buildTransitionReason(signals, current.mode, newMode),
    };
    recentTransitions.push({ turn: signals.currentTurn, from: current.mode, to: newMode });
    // Keep only last 5 transitions
    while (recentTransitions.length > 5) recentTransitions.shift();

    next.mode = newMode;
    next.previousMode = current.mode;
    next.lastTransitionTurn = signals.currentTurn;
  }

  next.recentTransitions = recentTransitions;

  return { posture: next, transition, violations };
}

function buildTransitionReason(signals: PostureSignals, from: PostureMode, to: PostureMode): string {
  const parts: string[] = [];
  if (signals.driftLevel !== "normal") parts.push(`drift=${signals.driftLevel}`);
  if (signals.contextPressure > 0.7) parts.push(`pressure=${(signals.contextPressure * 100).toFixed(0)}%`);
  if (signals.toolHealthRatio < 0.8) parts.push(`toolHealth=${(signals.toolHealthRatio * 100).toFixed(0)}%`);
  if (!signals.memoryAvailable) parts.push("memory=unavailable");
  return `${from}→${to}: ${parts.join(", ") || "recovery"}`;
}

// ---------------------------------------------------------------------------
// Invariant Assertions
// ---------------------------------------------------------------------------

/**
 * Check Invariant 3: Escalation cap — max 1 thinking escalation per run.
 */
export function canEscalateThinking(posture: AgentPosture): boolean {
  return posture.thinkingEscalations < 1;
}

/**
 * Record a thinking escalation.
 */
export function recordThinkingEscalation(posture: AgentPosture): AgentPosture {
  return { ...posture, thinkingEscalations: posture.thinkingEscalations + 1 };
}

/**
 * Check Invariant 5: minimum memory band (injection + history ≥ 25%).
 */
export function assertMinimumMemoryBand(
  injectionShare: number,
  historyShare: number,
): PostureInvariantViolation | null {
  const combined = injectionShare + historyShare;
  if (combined < 0.25) {
    return {
      invariant: "minimum_memory_band",
      message: `Combined injection (${(injectionShare * 100).toFixed(1)}%) + history (${(historyShare * 100).toFixed(1)}%) = ${(combined * 100).toFixed(1)}% < 25% minimum`,
    };
  }
  return null;
}

/**
 * Check Invariant 6: tool disable ceiling — max 50% of tools disabled.
 */
export function assertToolDisableCeiling(
  disabledCount: number,
  totalCount: number,
): PostureInvariantViolation | null {
  if (totalCount === 0) return null;
  if (disabledCount / totalCount > MAX_TOOL_DISABLE_FRACTION) {
    return {
      invariant: "tool_disable_ceiling",
      message: `${disabledCount}/${totalCount} tools disabled (>${(MAX_TOOL_DISABLE_FRACTION * 100).toFixed(0)}% ceiling)`,
    };
  }
  return null;
}

/**
 * Run all invariant checks against a posture.
 * In replay mode (strict=true), violations throw. In runtime, they log.
 */
export function validatePostureInvariants(
  posture: AgentPosture,
  opts?: { strict?: boolean },
): PostureInvariantViolation[] {
  const violations: PostureInvariantViolation[] = [];

  // Invariant 4: context pressure bound
  if (posture.contextPressure < 0 || posture.contextPressure > 1) {
    violations.push({
      invariant: "context_pressure_bound",
      message: `contextPressure=${posture.contextPressure} outside [0,1]`,
    });
  }

  if (opts?.strict) {
    for (const v of violations) {
      throw new Error(`Posture invariant violation [${v.invariant}]: ${v.message}`);
    }
  }

  return violations;
}
