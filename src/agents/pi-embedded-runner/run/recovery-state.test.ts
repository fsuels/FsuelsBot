import { describe, expect, it } from "vitest";
import {
  MAX_OVERFLOW_COMPACTION_ATTEMPTS,
  createEmbeddedRunRecoveryState,
  transitionEmbeddedRunRecovery,
} from "./recovery-state.js";

describe("embedded run recovery state", () => {
  it("caps proactive compaction retries", () => {
    let state = createEmbeddedRunRecoveryState();

    for (let attempt = 1; attempt <= MAX_OVERFLOW_COMPACTION_ATTEMPTS; attempt += 1) {
      const decision = transitionEmbeddedRunRecovery(state, {
        kind: "proactive_compaction_requested",
      });
      state = decision.nextState;
      expect(decision.effect).toMatchObject({
        kind: "attempt_compaction",
        reason: "proactive",
        attemptNumber: attempt,
      });
    }

    const exhausted = transitionEmbeddedRunRecovery(state, {
      kind: "proactive_compaction_requested",
    });
    expect(exhausted.effect).toEqual({ kind: "continue" });
    expect(exhausted.nextState).toEqual(state);
  });

  it("routes duplicate overflow prompts to tool-result truncation before failing", () => {
    const initial = createEmbeddedRunRecoveryState();

    const decision = transitionEmbeddedRunRecovery(initial, {
      kind: "context_overflow_detected",
      promptIsDuplicate: true,
      isCompactionFailure: false,
      hasOversizedToolResults: true,
    });
    expect(decision.effect).toEqual({ kind: "attempt_tool_result_truncation" });
    expect(decision.nextState.toolResultTruncationAttempted).toBe(true);

    const truncated = transitionEmbeddedRunRecovery(decision.nextState, {
      kind: "tool_result_truncation_completed",
      truncated: true,
    });
    expect(truncated.effect).toEqual({ kind: "retry" });
    expect(truncated.nextState.overflowCompactionAttempts).toBe(0);
  });

  it("returns compaction_failure immediately for non-recoverable overflow errors", () => {
    const decision = transitionEmbeddedRunRecovery(createEmbeddedRunRecoveryState(), {
      kind: "context_overflow_detected",
      promptIsDuplicate: false,
      isCompactionFailure: true,
      hasOversizedToolResults: true,
    });

    expect(decision.effect).toEqual({
      kind: "return_error",
      errorKind: "compaction_failure",
    });
  });

  it("falls back to truncation after overflow compaction fails", () => {
    const attemptedCompaction = transitionEmbeddedRunRecovery(createEmbeddedRunRecoveryState(), {
      kind: "context_overflow_detected",
      promptIsDuplicate: false,
      isCompactionFailure: false,
      hasOversizedToolResults: true,
    });
    expect(attemptedCompaction.effect).toMatchObject({
      kind: "attempt_compaction",
      reason: "overflow",
      attemptNumber: 1,
    });

    const afterFailure = transitionEmbeddedRunRecovery(attemptedCompaction.nextState, {
      kind: "overflow_compaction_completed",
      compacted: false,
      hasOversizedToolResults: true,
    });
    expect(afterFailure.effect).toEqual({ kind: "attempt_tool_result_truncation" });
    expect(afterFailure.nextState.toolResultTruncationAttempted).toBe(true);
  });

  it("fails once truncation was already attempted and overflow still remains", () => {
    const stateAfterTruncation = {
      overflowCompactionAttempts: 2,
      toolResultTruncationAttempted: true,
    } as const;

    const decision = transitionEmbeddedRunRecovery(stateAfterTruncation, {
      kind: "context_overflow_detected",
      promptIsDuplicate: true,
      isCompactionFailure: false,
      hasOversizedToolResults: true,
    });

    expect(decision.effect).toEqual({
      kind: "return_error",
      errorKind: "context_overflow",
    });
  });
});
