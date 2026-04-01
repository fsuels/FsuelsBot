export type SleepOptions = {
  throwOnAbort?: boolean;
  abortError?: (signal: AbortSignal) => unknown;
  unref?: boolean;
};

function createDefaultAbortError(): Error {
  const err = new Error("aborted");
  err.name = "AbortError";
  return err;
}

function toAbortError(signal: AbortSignal, options?: SleepOptions): unknown {
  if (typeof options?.abortError === "function") {
    return options.abortError(signal);
  }
  return createDefaultAbortError();
}

export async function sleep(
  ms: number,
  signal?: AbortSignal,
  options: SleepOptions = {},
): Promise<void> {
  const delayMs = Math.max(0, Math.floor(ms));
  if (delayMs <= 0) {
    if (signal?.aborted && options.throwOnAbort) {
      throw toAbortError(signal, options);
    }
    return;
  }

  if (signal?.aborted) {
    if (options.throwOnAbort) {
      throw toAbortError(signal, options);
    }
    return;
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let timeout: NodeJS.Timeout | null = null;

    const cleanup = () => {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      signal?.removeEventListener("abort", onAbort);
    };

    const finishResolve = () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve();
    };

    const finishReject = (error: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    };

    const onAbort = () => {
      if (options.throwOnAbort && signal) {
        finishReject(toAbortError(signal, options));
        return;
      }
      finishResolve();
    };

    timeout = setTimeout(finishResolve, delayMs);
    if (options.unref !== false) {
      timeout.unref?.();
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  const timeoutMs = Math.max(0, Math.floor(ms));
  if (timeoutMs <= 0) {
    return await promise;
  }

  let timeout: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);
    timeout.unref?.();
  });
  void timeoutPromise.catch(() => {});

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}
