import type { AnyAgentTool } from "./pi-tools.types.js";
import { createAbortControllerWithParents } from "./abort-tree.js";

function throwAbortError(): never {
  const err = new Error("Aborted");
  err.name = "AbortError";
  throw err;
}

function combineAbortSignals(
  a?: AbortSignal,
  b?: AbortSignal,
): { signal?: AbortSignal; dispose: () => void } {
  if (!a && !b) {
    return {
      signal: undefined,
      dispose: () => undefined,
    };
  }
  if (a && !b) {
    return {
      signal: a,
      dispose: () => undefined,
    };
  }
  if (b && !a) {
    return {
      signal: b,
      dispose: () => undefined,
    };
  }
  if (a?.aborted) {
    return {
      signal: a,
      dispose: () => undefined,
    };
  }
  if (b?.aborted) {
    return {
      signal: b,
      dispose: () => undefined,
    };
  }

  return createAbortControllerWithParents([a, b]);
}

export function wrapToolWithAbortSignal(
  tool: AnyAgentTool,
  abortSignal?: AbortSignal,
): AnyAgentTool {
  if (!abortSignal) {
    return tool;
  }
  const execute = tool.execute;
  if (!execute) {
    return tool;
  }
  return {
    ...tool,
    execute: async (toolCallId, params, signal, onUpdate) => {
      const combined = combineAbortSignals(signal, abortSignal);
      if (combined.signal?.aborted) {
        throwAbortError();
      }
      try {
        return await execute(toolCallId, params, combined.signal, onUpdate);
      } finally {
        combined.dispose();
      }
    },
  };
}
