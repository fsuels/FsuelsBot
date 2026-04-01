export type LinkedAbortController = {
  controller: AbortController;
  signal: AbortSignal;
  dispose: () => void;
};

export function getAbortReason(signal: AbortSignal): unknown {
  return "reason" in signal ? (signal as AbortSignal & { reason?: unknown }).reason : undefined;
}

function abortWithReason(controller: AbortController, reason: unknown) {
  if (reason === undefined) {
    controller.abort();
    return;
  }
  try {
    controller.abort(reason);
  } catch {
    controller.abort();
  }
}

export function createAbortControllerWithParents(
  parents: Array<AbortSignal | null | undefined>,
): LinkedAbortController {
  const controller = new AbortController();
  const listeners: Array<{ signal: AbortSignal; onAbort: () => void }> = [];

  const dispose = () => {
    while (listeners.length > 0) {
      const entry = listeners.pop();
      entry?.signal.removeEventListener("abort", entry.onAbort);
    }
  };

  for (const parent of parents) {
    if (!parent) {
      continue;
    }
    if (parent.aborted) {
      abortWithReason(controller, getAbortReason(parent));
      break;
    }
    const onAbort = () => abortWithReason(controller, getAbortReason(parent));
    parent.addEventListener("abort", onAbort, { once: true });
    listeners.push({ signal: parent, onAbort });
  }

  controller.signal.addEventListener("abort", dispose, { once: true });

  return {
    controller,
    signal: controller.signal,
    dispose,
  };
}
