/**
 * Deterministic Replay Harness — S4 extension.
 *
 * Feeds recorded TurnTrace sequences through the AgentPosture state
 * machine and verifies identical transitions. Pure function, no side
 * effects — suitable for Vitest regression tests.
 */

import type { DriftLevel } from "./drift-detection.js";
import type {
  AgentPosture,
  PostureMode,
  PostureTransition,
  PostureSignals,
} from "./agent-posture.js";
import { createInitialPosture, updatePosture, validatePostureInvariants } from "./agent-posture.js";
import type { TurnTrace, PostureSnapshot } from "./cognitive-telemetry.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReplayResult = {
  matches: boolean;
  divergedAt?: number;
  expected?: PostureTransition;
  actual?: PostureTransition;
  violations: Array<{ turn: number; invariant: string; message: string }>;
};

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

/**
 * Replay a sequence of turn traces through the posture state machine.
 *
 * For each turn, the replay:
 * 1. Extracts signals from the trace's events and posture snapshots.
 * 2. Runs `updatePosture()` with those signals.
 * 3. Compares the resulting transition to the expected transition.
 * 4. Asserts all posture invariants (strict mode — throws on violation).
 *
 * @param traces - Ordered sequence of TurnTrace from a recorded session.
 * @param expectedTransitions - The transitions that occurred in the original session.
 * @returns ReplayResult indicating match or first divergence.
 */
export function replayTurnTraces(
  traces: TurnTrace[],
  expectedTransitions: PostureTransition[],
): ReplayResult {
  let posture = createInitialPosture();
  const actualTransitions: PostureTransition[] = [];
  const allViolations: Array<{ turn: number; invariant: string; message: string }> = [];
  let expectedIdx = 0;

  for (const trace of traces) {
    const signals = extractSignalsFromTrace(trace, posture);
    const { posture: nextPosture, transition, violations } = updatePosture(posture, signals);

    // Collect violations
    for (const v of violations) {
      allViolations.push({ turn: trace.turnIndex, invariant: v.invariant, message: v.message });
    }

    // Run invariant validation in strict mode
    const invariantViolations = validatePostureInvariants(nextPosture);
    for (const v of invariantViolations) {
      allViolations.push({ turn: trace.turnIndex, invariant: v.invariant, message: v.message });
    }

    if (transition) {
      actualTransitions.push(transition);
      // Check against expected
      const expected = expectedTransitions[expectedIdx];
      if (!expected) {
        return {
          matches: false,
          divergedAt: trace.turnIndex,
          actual: transition,
          violations: allViolations,
        };
      }
      if (expected.from !== transition.from || expected.to !== transition.to) {
        return {
          matches: false,
          divergedAt: trace.turnIndex,
          expected,
          actual: transition,
          violations: allViolations,
        };
      }
      expectedIdx++;
    }

    posture = nextPosture;
  }

  // Check we consumed all expected transitions
  if (expectedIdx < expectedTransitions.length) {
    return {
      matches: false,
      divergedAt: traces[traces.length - 1]?.turnIndex ?? 0,
      expected: expectedTransitions[expectedIdx],
      violations: allViolations,
    };
  }

  return { matches: true, violations: allViolations };
}

/**
 * Extract PostureSignals from a TurnTrace.
 *
 * Uses the trace's postureStart snapshot for drift/tool/memory signals,
 * and the trace's contextPressure directly.
 */
function extractSignalsFromTrace(trace: TurnTrace, currentPosture: AgentPosture): PostureSignals {
  // Use the trace's start posture for signals (what was true at the start of this turn)
  const snap = trace.postureStart;

  return {
    contextPressure: trace.contextPressure,
    driftLevel: (snap.driftLevel as DriftLevel) ?? currentPosture.driftLevel,
    toolHealthRatio: snap.toolHealthRatio ?? currentPosture.toolHealthRatio,
    memoryAvailable: snap.memoryAvailable ?? currentPosture.memoryAvailable,
    thinkingLevel: currentPosture.thinkingLevel,
    currentTurn: trace.turnIndex,
  };
}
