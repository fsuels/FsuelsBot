export const MAX_OVERFLOW_COMPACTION_ATTEMPTS = 3;

export type EmbeddedRunRecoveryState = Readonly<{
  overflowCompactionAttempts: number;
  toolResultTruncationAttempted: boolean;
}>;

export type EmbeddedRunRecoveryEffect =
  | Readonly<{
      kind: "attempt_compaction";
      reason: "proactive" | "overflow";
      attemptNumber: number;
      maxAttempts: number;
    }>
  | Readonly<{ kind: "attempt_tool_result_truncation" }>
  | Readonly<{ kind: "retry" }>
  | Readonly<{ kind: "continue" }>
  | Readonly<{
      kind: "return_error";
      errorKind: "context_overflow" | "compaction_failure";
    }>;

export type EmbeddedRunRecoveryInput =
  | Readonly<{ kind: "proactive_compaction_requested" }>
  | Readonly<{
      kind: "proactive_compaction_completed";
      compacted: boolean;
    }>
  | Readonly<{
      kind: "context_overflow_detected";
      promptIsDuplicate: boolean;
      isCompactionFailure: boolean;
      hasOversizedToolResults: boolean;
    }>
  | Readonly<{
      kind: "overflow_compaction_completed";
      compacted: boolean;
      hasOversizedToolResults: boolean;
    }>
  | Readonly<{
      kind: "tool_result_truncation_completed";
      truncated: boolean;
    }>;

export function createEmbeddedRunRecoveryState(): EmbeddedRunRecoveryState {
  return {
    overflowCompactionAttempts: 0,
    toolResultTruncationAttempted: false,
  };
}

export function transitionEmbeddedRunRecovery(
  state: EmbeddedRunRecoveryState,
  input: EmbeddedRunRecoveryInput,
): {
  nextState: EmbeddedRunRecoveryState;
  effect: EmbeddedRunRecoveryEffect;
} {
  switch (input.kind) {
    case "proactive_compaction_requested": {
      if (state.overflowCompactionAttempts >= MAX_OVERFLOW_COMPACTION_ATTEMPTS) {
        return {
          nextState: state,
          effect: { kind: "continue" },
        };
      }
      const nextState = {
        ...state,
        overflowCompactionAttempts: state.overflowCompactionAttempts + 1,
      } satisfies EmbeddedRunRecoveryState;
      return {
        nextState,
        effect: {
          kind: "attempt_compaction",
          reason: "proactive",
          attemptNumber: nextState.overflowCompactionAttempts,
          maxAttempts: MAX_OVERFLOW_COMPACTION_ATTEMPTS,
        },
      };
    }

    case "proactive_compaction_completed":
      return {
        nextState: state,
        effect: input.compacted ? { kind: "retry" } : { kind: "continue" },
      };

    case "context_overflow_detected": {
      if (input.isCompactionFailure) {
        return {
          nextState: state,
          effect: { kind: "return_error", errorKind: "compaction_failure" },
        };
      }
      if (
        !input.promptIsDuplicate &&
        state.overflowCompactionAttempts < MAX_OVERFLOW_COMPACTION_ATTEMPTS
      ) {
        const nextState = {
          ...state,
          overflowCompactionAttempts: state.overflowCompactionAttempts + 1,
        } satisfies EmbeddedRunRecoveryState;
        return {
          nextState,
          effect: {
            kind: "attempt_compaction",
            reason: "overflow",
            attemptNumber: nextState.overflowCompactionAttempts,
            maxAttempts: MAX_OVERFLOW_COMPACTION_ATTEMPTS,
          },
        };
      }
      if (!state.toolResultTruncationAttempted && input.hasOversizedToolResults) {
        return {
          nextState: {
            ...state,
            toolResultTruncationAttempted: true,
          },
          effect: { kind: "attempt_tool_result_truncation" },
        };
      }
      return {
        nextState: state,
        effect: { kind: "return_error", errorKind: "context_overflow" },
      };
    }

    case "overflow_compaction_completed": {
      if (input.compacted) {
        return {
          nextState: state,
          effect: { kind: "retry" },
        };
      }
      if (!state.toolResultTruncationAttempted && input.hasOversizedToolResults) {
        return {
          nextState: {
            ...state,
            toolResultTruncationAttempted: true,
          },
          effect: { kind: "attempt_tool_result_truncation" },
        };
      }
      return {
        nextState: state,
        effect: { kind: "return_error", errorKind: "context_overflow" },
      };
    }

    case "tool_result_truncation_completed":
      if (input.truncated) {
        return {
          nextState: {
            ...state,
            overflowCompactionAttempts: 0,
          },
          effect: { kind: "retry" },
        };
      }
      return {
        nextState: state,
        effect: { kind: "return_error", errorKind: "context_overflow" },
      };

    default: {
      const exhaustive: never = input;
      return exhaustive;
    }
  }
}
