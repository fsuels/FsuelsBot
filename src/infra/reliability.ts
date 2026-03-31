import { formatErrorMessage } from "./errors.js";
import { retryAsync, type RetryConfig } from "./retry.js";

export type OperationCriticality = "critical" | "best_effort" | "fire_and_forget";

export type ReliableOperationResult<T> =
  | {
      ok: true;
      value: T;
      fallbackUsed: boolean;
      message?: string;
    }
  | {
      ok: false;
      error: unknown;
      criticality: Exclude<OperationCriticality, "fire_and_forget">;
      message: string;
    };

export type ReliableOperationLogger = {
  debug?: (message: string) => void;
  warn?: (message: string) => void;
};

function buildFailureMessage(name: string, error: unknown): string {
  return `${name} failed: ${formatErrorMessage(error)}`;
}

async function runWithTimeout<T>(
  task: () => Promise<T>,
  timeoutMs: number | undefined,
  name: string,
): Promise<T> {
  if (timeoutMs === undefined) {
    return await task();
  }

  const normalizedTimeoutMs = Math.max(1, Math.floor(timeoutMs));
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race<T>([
      task(),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`${name} timed out after ${normalizedTimeoutMs}ms`));
        }, normalizedTimeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export async function runReliableOperation<T>(params: {
  name: string;
  criticality: Exclude<OperationCriticality, "fire_and_forget">;
  task: () => Promise<T>;
  timeoutMs?: number;
  retry?: RetryConfig;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  fallback?: (error: unknown) => Promise<T> | T;
  logger?: ReliableOperationLogger;
}): Promise<ReliableOperationResult<T>> {
  const runTask = async () => await runWithTimeout(params.task, params.timeoutMs, params.name);

  try {
    const value =
      params.retry || params.shouldRetry
        ? await retryAsync(runTask, {
            attempts: params.retry?.attempts ?? 1,
            minDelayMs: params.retry?.minDelayMs ?? 0,
            maxDelayMs: params.retry?.maxDelayMs ?? 0,
            jitter: params.retry?.jitter ?? 0,
            label: params.name,
            shouldRetry: params.shouldRetry,
          })
        : await runTask();
    return {
      ok: true,
      value,
      fallbackUsed: false,
    };
  } catch (error) {
    if (params.fallback) {
      const value = await params.fallback(error);
      const message = `${buildFailureMessage(params.name, error)}; using fallback`;
      params.logger?.debug?.(message);
      return {
        ok: true,
        value,
        fallbackUsed: true,
        message,
      };
    }

    const message = buildFailureMessage(params.name, error);
    if (params.criticality === "best_effort") {
      params.logger?.warn?.(message);
    }
    return {
      ok: false,
      error,
      criticality: params.criticality,
      message,
    };
  }
}

export function launchReliableOperation(params: {
  name: string;
  task: () => Promise<unknown>;
  timeoutMs?: number;
  retry?: RetryConfig;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  logger?: ReliableOperationLogger;
}): void {
  const { logger, ...rest } = params;
  void runReliableOperation({
    ...rest,
    criticality: "best_effort",
  }).then((result) => {
    if (!result.ok) {
      logger?.warn?.(result.message);
    }
  });
}
