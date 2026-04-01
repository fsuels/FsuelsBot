import type { ChildProcess, SpawnOptions } from "node:child_process";
import { spawn } from "node:child_process";
import fs from "node:fs";
import { resolveAgentRuntimeCwd } from "../agents/runtime-context.js";

const STARTUP_CWD = safeExistingDirectory(() => process.cwd());

export type SpawnFallback = {
  label: string;
  options: SpawnOptions;
};

export type SpawnWithFallbackResult = {
  child: ChildProcess;
  usedFallback: boolean;
  fallbackLabel?: string;
};

type SpawnWithFallbackParams = {
  argv: string[];
  options: SpawnOptions;
  fallbacks?: SpawnFallback[];
  spawnImpl?: typeof spawn;
  retryCodes?: string[];
  onFallback?: (err: unknown, fallback: SpawnFallback) => void;
};

const DEFAULT_RETRY_CODES = ["EBADF"];

export function resolveCommandStdio(params: {
  hasInput: boolean;
  preferInherit: boolean;
}): ["pipe" | "inherit" | "ignore", "pipe", "pipe"] {
  const stdin = params.hasInput ? "pipe" : params.preferInherit ? "inherit" : "ignore";
  return [stdin, "pipe", "pipe"];
}

function safeExistingDirectory(read: () => string): string | null {
  try {
    const value = read();
    if (!value) {
      return null;
    }
    const stats = fs.statSync(value);
    return stats.isDirectory() ? value : null;
  } catch {
    return null;
  }
}

export function getStartupCwd(): string | null {
  return STARTUP_CWD;
}

export function safeProcessCwd(): string | null {
  return safeExistingDirectory(() => resolveAgentRuntimeCwd());
}

export function resolveSpawnWorkingDirectory(cwd?: string): string {
  if (typeof cwd === "string" && cwd.trim().length > 0) {
    const explicit = safeExistingDirectory(() => cwd);
    if (explicit) {
      return explicit;
    }
    throw new Error(`Working directory "${cwd}" does not exist or is not a directory.`);
  }

  const current = safeProcessCwd();
  if (current) {
    return current;
  }

  const startup = getStartupCwd();
  if (startup) {
    return startup;
  }

  throw new Error(
    "Current working directory is unavailable and the original startup working directory could not be recovered.",
  );
}

export function killProcessTree(pid: number): void {
  if (process.platform === "win32") {
    try {
      spawn("taskkill", ["/F", "/T", "/PID", String(pid)], {
        stdio: "ignore",
        detached: true,
      });
    } catch {
      // ignore errors if taskkill fails
    }
    return;
  }

  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // process already dead
    }
  }
}

export function formatSpawnError(err: unknown): string {
  if (!(err instanceof Error)) {
    return String(err);
  }
  const details = err as NodeJS.ErrnoException;
  const parts: string[] = [];
  const message = err.message?.trim();
  if (message) {
    parts.push(message);
  }
  if (details.code && !message?.includes(details.code)) {
    parts.push(details.code);
  }
  if (details.syscall) {
    parts.push(`syscall=${details.syscall}`);
  }
  if (typeof details.errno === "number") {
    parts.push(`errno=${details.errno}`);
  }
  return parts.join(" ");
}

function shouldRetry(err: unknown, codes: string[]): boolean {
  const code =
    err && typeof err === "object" && "code" in err ? String((err as { code?: unknown }).code) : "";
  return code.length > 0 && codes.includes(code);
}

async function spawnAndWaitForSpawn(
  spawnImpl: typeof spawn,
  argv: string[],
  options: SpawnOptions,
): Promise<ChildProcess> {
  const child = spawnImpl(argv[0], argv.slice(1), options);

  return await new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      child.removeListener("error", onError);
      child.removeListener("spawn", onSpawn);
    };
    const finishResolve = () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(child);
    };
    const onError = (err: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(err);
    };
    const onSpawn = () => {
      finishResolve();
    };
    child.once("error", onError);
    child.once("spawn", onSpawn);
    // Ensure mocked spawns that never emit "spawn" don't stall.
    process.nextTick(() => {
      if (typeof child.pid === "number") {
        finishResolve();
      }
    });
  });
}

export async function spawnWithFallback(
  params: SpawnWithFallbackParams,
): Promise<SpawnWithFallbackResult> {
  const spawnImpl = params.spawnImpl ?? spawn;
  const retryCodes = params.retryCodes ?? DEFAULT_RETRY_CODES;
  const baseOptions = { ...params.options };
  const fallbacks = params.fallbacks ?? [];
  const attempts: Array<{ label?: string; options: SpawnOptions }> = [
    { options: baseOptions },
    ...fallbacks.map((fallback) => ({
      label: fallback.label,
      options: { ...baseOptions, ...fallback.options },
    })),
  ];

  let lastError: unknown;
  for (let index = 0; index < attempts.length; index += 1) {
    const attempt = attempts[index];
    try {
      const child = await spawnAndWaitForSpawn(spawnImpl, params.argv, attempt.options);
      return {
        child,
        usedFallback: index > 0,
        fallbackLabel: attempt.label,
      };
    } catch (err) {
      lastError = err;
      const nextFallback = fallbacks[index];
      if (!nextFallback || !shouldRetry(err, retryCodes)) {
        throw err;
      }
      params.onFallback?.(err, nextFallback);
    }
  }

  throw lastError;
}
