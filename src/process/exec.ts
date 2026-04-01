import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { danger, shouldLogVerbose } from "../globals.js";
import { logDebug, logError } from "../logger.js";
import {
  formatSpawnError,
  killProcessTree,
  resolveCommandStdio,
  resolveSpawnWorkingDirectory,
  spawnWithFallback,
} from "./spawn-utils.js";

const execFileAsync = promisify(execFile);
const DEFAULT_INLINE_OUTPUT_LIMIT_BYTES = 256 * 1024;
const DEFAULT_POST_EXIT_DRAIN_MS = 50;

type ExecFileOptions = {
  timeoutMs?: number;
  maxBuffer?: number;
  cwd?: string;
};

type OutputCapture = {
  taskId: string;
  dirPath: string;
  stdoutFilePath: string;
  stderrFilePath: string;
  outputFilePath: string;
  stdoutWriter: fs.WriteStream;
  stderrWriter: fs.WriteStream;
  outputWriter: fs.WriteStream;
  stdoutSize: number;
  stderrSize: number;
  outputSize: number;
  error: Error | null;
};

type InlineOutput = {
  text: string;
  truncated: boolean;
};

export type ExecFileNoThrowOptions = {
  cwd: string;
  timeoutMs?: number;
  input?: string;
  env?: NodeJS.ProcessEnv;
  windowsVerbatimArguments?: boolean;
  abortSignal?: AbortSignal;
  inlineOutputLimitBytes?: number;
  outputDir?: string;
  postExitDrainMs?: number;
  stdin?: "ignore" | "pipe" | "inherit";
};

export type ExecFileNoThrowResult = SpawnResult & {
  durationMs: number;
};

const SECRET_ENV_KEY_RE = /(token|secret|pass(word)?|api[-_]?key|auth(orization)?|cookie)/i;
const SECRET_ARG_FLAG_RE =
  /^--?(token|secret|password|pass|api[-_]?key|auth|authorization|cookie)$/i;
const SECRET_ARG_ASSIGNMENT_RE =
  /^(--?[a-z0-9_-]*?(token|secret|password|pass|api[-_]?key|auth|authorization|cookie)[a-z0-9_-]*)=/i;

/**
 * Resolves a command for Windows compatibility.
 * On Windows, non-.exe commands (like npm, pnpm) require their .cmd extension.
 */
function resolveCommand(command: string): string {
  if (process.platform !== "win32") {
    return command;
  }
  const basename = path.basename(command).toLowerCase();
  const ext = path.extname(basename);
  if (ext) {
    return command;
  }
  const cmdCommands = ["npm", "pnpm", "yarn", "npx"];
  if (cmdCommands.includes(basename)) {
    return `${command}.cmd`;
  }
  return command;
}

function redactArgsForLog(args: string[]): string[] {
  const redacted: string[] = [];
  let redactNext = false;
  for (const arg of args) {
    if (redactNext) {
      redacted.push("<redacted>");
      redactNext = false;
      continue;
    }
    if (SECRET_ARG_FLAG_RE.test(arg)) {
      redacted.push(arg);
      redactNext = true;
      continue;
    }
    if (SECRET_ARG_ASSIGNMENT_RE.test(arg)) {
      const [key] = arg.split("=", 1);
      redacted.push(`${key}=<redacted>`);
      continue;
    }
    redacted.push(arg);
  }
  return redacted;
}

function redactEnvForLog(env?: NodeJS.ProcessEnv): Record<string, string> | undefined {
  if (!env) {
    return undefined;
  }
  const entries = Object.entries(env)
    .filter(([, value]): value is string => typeof value === "string")
    .map(([key, value]) => [key, SECRET_ENV_KEY_RE.test(key) ? "<redacted>" : value] as const);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function shouldSuppressNpmFund(command: string, args: string[]): boolean {
  const cmd = path.basename(command);
  if (cmd === "npm" || cmd === "npm.cmd" || cmd === "npm.exe") {
    return true;
  }
  if (cmd === "node" || cmd === "node.exe") {
    const script = args[0] ?? "";
    return script.includes("npm-cli.js");
  }
  return false;
}

function shouldApplyGitExecPolicy(command: string): boolean {
  const basename = path.basename(command).toLowerCase();
  return basename === "git" || basename === "git.exe";
}

function resolveCommandEnv(
  command: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const resolvedEnv = env ? { ...process.env, ...env } : { ...process.env };
  if (shouldSuppressNpmFund(command, args)) {
    if (resolvedEnv.NPM_CONFIG_FUND == null) {
      resolvedEnv.NPM_CONFIG_FUND = "false";
    }
    if (resolvedEnv.npm_config_fund == null) {
      resolvedEnv.npm_config_fund = "false";
    }
  }
  if (shouldApplyGitExecPolicy(command)) {
    if (resolvedEnv.GIT_TERMINAL_PROMPT == null) {
      resolvedEnv.GIT_TERMINAL_PROMPT = "0";
    }
    if (resolvedEnv.GIT_ASKPASS == null) {
      resolvedEnv.GIT_ASKPASS = "";
    }
    if (resolvedEnv.SSH_ASKPASS == null) {
      resolvedEnv.SSH_ASKPASS = "";
    }
  }
  return resolvedEnv;
}

function logExecNoThrowResult(params: {
  command: string;
  args: string[];
  options: ExecFileNoThrowOptions;
  result: ExecFileNoThrowResult;
}) {
  if (!shouldLogVerbose()) {
    return;
  }
  const payload = JSON.stringify({
    command: params.command,
    args: redactArgsForLog(params.args),
    cwd: params.options.cwd,
    timeoutMs: params.options.timeoutMs,
    code: params.result.code,
    signal: params.result.signal,
    killed: params.result.killed,
    timedOut: params.result.timedOut,
    durationMs: params.result.durationMs,
    env: redactEnvForLog(params.options.env),
  });
  if (params.result.code !== 0 || params.result.signal !== null || params.result.timedOut) {
    logError(`process: ${payload}`);
    return;
  }
  logDebug(`process: ${payload}`);
}

async function createOutputCapture(baseDir?: string): Promise<OutputCapture> {
  const taskId = randomUUID();
  const dirPath = await fsp.mkdtemp(path.join(baseDir ?? os.tmpdir(), "openclaw-exec-"));
  const stdoutFilePath = path.join(dirPath, "stdout.log");
  const stderrFilePath = path.join(dirPath, "stderr.log");
  const outputFilePath = path.join(dirPath, "output.log");
  return {
    taskId,
    dirPath,
    stdoutFilePath,
    stderrFilePath,
    outputFilePath,
    stdoutWriter: fs.createWriteStream(stdoutFilePath),
    stderrWriter: fs.createWriteStream(stderrFilePath),
    outputWriter: fs.createWriteStream(outputFilePath),
    stdoutSize: 0,
    stderrSize: 0,
    outputSize: 0,
    error: null,
  };
}

function appendCaptureChunk(
  capture: OutputCapture,
  stream: "stdout" | "stderr",
  chunk: Buffer | string,
): void {
  const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  if (stream === "stdout") {
    capture.stdoutSize += buffer.length;
    capture.stdoutWriter.write(buffer);
  } else {
    capture.stderrSize += buffer.length;
    capture.stderrWriter.write(buffer);
  }
  capture.outputSize += buffer.length;
  capture.outputWriter.write(buffer);
}

async function closeWriter(writer: fs.WriteStream): Promise<void> {
  if (writer.destroyed) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const onFinish = () => {
      cleanup();
      resolve();
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const cleanup = () => {
      writer.off("finish", onFinish);
      writer.off("error", onError);
    };
    writer.once("finish", onFinish);
    writer.once("error", onError);
    writer.end();
  });
}

async function finalizeCapture(capture: OutputCapture): Promise<void> {
  await Promise.all([
    closeWriter(capture.stdoutWriter),
    closeWriter(capture.stderrWriter),
    closeWriter(capture.outputWriter),
  ]);
}

async function readInlineOutput(
  filePath: string,
  size: number,
  limitBytes: number,
): Promise<InlineOutput> {
  if (size <= 0) {
    return { text: "", truncated: false };
  }
  if (size <= limitBytes) {
    return {
      text: await fsp.readFile(filePath, "utf8"),
      truncated: false,
    };
  }

  const fd = await fsp.open(filePath, "r");
  try {
    const length = Math.max(0, Math.floor(limitBytes));
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await fd.read(buffer, 0, length, 0);
    return {
      text: buffer.subarray(0, bytesRead).toString("utf8"),
      truncated: true,
    };
  } finally {
    await fd.close();
  }
}

// Simple promise-wrapped execFile with optional verbosity logging.
export async function runExec(
  command: string,
  args: string[],
  opts: number | ExecFileOptions = 10_000,
): Promise<{ stdout: string; stderr: string }> {
  const cwd = resolveSpawnWorkingDirectory(typeof opts === "number" ? undefined : opts.cwd);
  const options =
    typeof opts === "number"
      ? { timeout: opts, cwd, encoding: "utf8" as const }
      : {
          timeout: opts.timeoutMs,
          maxBuffer: opts.maxBuffer,
          cwd,
          encoding: "utf8" as const,
        };
  try {
    const { stdout, stderr } = await execFileAsync(resolveCommand(command), args, options);
    if (shouldLogVerbose()) {
      if (stdout.trim()) {
        logDebug(stdout.trim());
      }
      if (stderr.trim()) {
        logError(stderr.trim());
      }
    }
    return { stdout, stderr };
  } catch (err) {
    if (shouldLogVerbose()) {
      logError(danger(`Command failed: ${command} ${args.join(" ")}`));
    }
    throw err;
  }
}

export type SpawnResult = {
  stdout: string;
  stderr: string;
  code: number | null;
  signal: NodeJS.Signals | null;
  killed: boolean;
  timedOut?: boolean;
  cwd?: string;
  outputTaskId?: string;
  outputFilePath?: string;
  outputFileSize?: number;
  stdoutFilePath?: string;
  stderrFilePath?: string;
  stdoutSize?: number;
  stderrSize?: number;
  stdoutTruncated?: boolean;
  stderrTruncated?: boolean;
};

export type CommandOptions = {
  timeoutMs: number;
  cwd?: string;
  input?: string;
  env?: NodeJS.ProcessEnv;
  windowsVerbatimArguments?: boolean;
  abortSignal?: AbortSignal;
  inlineOutputLimitBytes?: number;
  outputDir?: string;
  postExitDrainMs?: number;
  stdin?: "ignore" | "pipe" | "inherit";
};

function createAbortError(signal: AbortSignal): Error {
  const reason = signal.reason;
  if (reason instanceof Error) {
    return reason;
  }
  const err = new Error(typeof reason === "string" && reason.trim() ? reason : "aborted");
  err.name = "AbortError";
  return err;
}

export async function execFileNoThrow(
  command: string,
  args: string[],
  options: ExecFileNoThrowOptions,
): Promise<ExecFileNoThrowResult> {
  if (!options.cwd?.trim()) {
    throw new Error("execFileNoThrow requires an explicit cwd.");
  }
  const startedAt = Date.now();
  try {
    const result = await runCommandWithTimeout([command, ...args], {
      timeoutMs: options.timeoutMs ?? 10_000,
      cwd: options.cwd,
      input: options.input,
      env: options.env,
      windowsVerbatimArguments: options.windowsVerbatimArguments,
      abortSignal: options.abortSignal,
      inlineOutputLimitBytes: options.inlineOutputLimitBytes,
      outputDir: options.outputDir,
      postExitDrainMs: options.postExitDrainMs,
      stdin: options.stdin,
    });
    const completed = {
      ...result,
      durationMs: Date.now() - startedAt,
    };
    logExecNoThrowResult({
      command,
      args,
      options,
      result: completed,
    });
    return completed;
  } catch (err) {
    const failed: ExecFileNoThrowResult = {
      stdout: "",
      stderr: formatSpawnError(err),
      code: null,
      signal: null,
      killed: false,
      timedOut: false,
      cwd: options.cwd,
      durationMs: Date.now() - startedAt,
    };
    logExecNoThrowResult({
      command,
      args,
      options,
      result: failed,
    });
    return failed;
  }
}

export async function runCommandWithTimeout(
  argv: string[],
  optionsOrTimeout: number | CommandOptions,
): Promise<SpawnResult> {
  if (!Array.isArray(argv) || argv.length === 0 || typeof argv[0] !== "string" || !argv[0]) {
    throw new Error("runCommandWithTimeout requires a non-empty argv");
  }

  const options: CommandOptions =
    typeof optionsOrTimeout === "number" ? { timeoutMs: optionsOrTimeout } : optionsOrTimeout;
  const { timeoutMs, cwd, input, env, windowsVerbatimArguments, abortSignal, outputDir } = options;
  const inlineOutputLimitBytes = Math.max(
    1,
    Math.floor(options.inlineOutputLimitBytes ?? DEFAULT_INLINE_OUTPUT_LIMIT_BYTES),
  );
  const postExitDrainMs = Math.max(
    0,
    Math.floor(options.postExitDrainMs ?? DEFAULT_POST_EXIT_DRAIN_MS),
  );
  const hasInput = input !== undefined;
  const resolvedCwd = resolveSpawnWorkingDirectory(cwd);
  const resolvedEnv = resolveCommandEnv(argv[0], argv.slice(1), env);

  if (abortSignal?.aborted) {
    throw createAbortError(abortSignal);
  }

  const capture = await createOutputCapture(outputDir);
  const stdinMode = hasInput ? "pipe" : (options.stdin ?? "ignore");
  const stdio =
    stdinMode === "inherit"
      ? resolveCommandStdio({ hasInput, preferInherit: true })
      : ([stdinMode, "pipe", "pipe"] as const);
  const fallbackStdio = resolveCommandStdio({ hasInput, preferInherit: false });
  const spawnArgv = [resolveCommand(argv[0]), ...argv.slice(1)];
  let child: Awaited<ReturnType<typeof spawnWithFallback>>["child"];
  try {
    const spawned = await spawnWithFallback({
      argv: spawnArgv,
      options: {
        stdio,
        cwd: resolvedCwd,
        env: resolvedEnv,
        detached: process.platform !== "win32",
        windowsHide: true,
        windowsVerbatimArguments,
      },
      fallbacks: [
        {
          label: "no-detach",
          options: {
            detached: false,
          },
        },
        {
          label: "safe-stdin",
          options: {
            detached: false,
            stdio: fallbackStdio,
          },
        },
      ],
    });
    child = spawned.child;
  } catch (err) {
    await finalizeCapture(capture).catch(() => {});
    throw err;
  }

  return await new Promise<SpawnResult>((resolve, reject) => {
    let settled = false;
    let hasExitEvent = false;
    let closed = false;
    let timedOut = false;
    let aborted = false;
    let exitCode: number | null = null;
    let exitSignal: NodeJS.Signals | null = null;
    let timeoutTimer: NodeJS.Timeout | null = null;
    let drainTimer: NodeJS.Timeout | null = null;

    const onStdout = (chunk: Buffer | string) => {
      try {
        appendCaptureChunk(capture, "stdout", chunk);
      } catch (err) {
        capture.error = err instanceof Error ? err : new Error(String(err));
        if (typeof child.pid === "number") {
          killProcessTree(child.pid);
        }
      }
    };

    const onStderr = (chunk: Buffer | string) => {
      try {
        appendCaptureChunk(capture, "stderr", chunk);
      } catch (err) {
        capture.error = err instanceof Error ? err : new Error(String(err));
        if (typeof child.pid === "number") {
          killProcessTree(child.pid);
        }
      }
    };

    const abortListener = () => {
      aborted = true;
      if (typeof child.pid === "number") {
        killProcessTree(child.pid);
      } else {
        child.kill("SIGKILL");
      }
    };

    const cleanup = () => {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
        timeoutTimer = null;
      }
      if (drainTimer) {
        clearTimeout(drainTimer);
        drainTimer = null;
      }
      abortSignal?.removeEventListener("abort", abortListener);
      child.stdout?.off("data", onStdout);
      child.stderr?.off("data", onStderr);
      child.removeListener("close", onClose);
      child.removeListener("error", onError);
      child.removeListener("exit", onExit);
      child.stdout?.destroy();
      child.stderr?.destroy();
    };

    const settleReject = (error: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      void finalizeCapture(capture).finally(() => {
        reject(error);
      });
    };

    const finalize = async () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      try {
        await finalizeCapture(capture);
        if (capture.error) {
          throw capture.error;
        }
        const [stdout, stderr] = await Promise.all([
          readInlineOutput(capture.stdoutFilePath, capture.stdoutSize, inlineOutputLimitBytes),
          readInlineOutput(capture.stderrFilePath, capture.stderrSize, inlineOutputLimitBytes),
        ]);
        if (aborted && abortSignal) {
          reject(createAbortError(abortSignal));
          return;
        }
        resolve({
          stdout: stdout.text,
          stderr: stderr.text,
          code: exitCode,
          signal: exitSignal,
          killed: child.killed || timedOut || aborted,
          timedOut,
          cwd: resolvedCwd,
          outputTaskId: capture.taskId,
          outputFilePath: capture.outputFilePath,
          outputFileSize: capture.outputSize,
          stdoutFilePath: capture.stdoutFilePath,
          stderrFilePath: capture.stderrFilePath,
          stdoutSize: capture.stdoutSize,
          stderrSize: capture.stderrSize,
          stdoutTruncated: stdout.truncated,
          stderrTruncated: stderr.truncated,
        });
      } catch (err) {
        reject(err);
      }
    };

    const scheduleFinalize = () => {
      if (closed || postExitDrainMs === 0) {
        void finalize();
        return;
      }
      if (drainTimer) {
        return;
      }
      drainTimer = setTimeout(() => {
        void finalize();
      }, postExitDrainMs);
      drainTimer.unref?.();
    };

    const onError = (err: unknown) => {
      settleReject(err);
    };

    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      hasExitEvent = true;
      exitCode = code;
      exitSignal = signal;
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
        timeoutTimer = null;
      }
      scheduleFinalize();
    };

    const onClose = () => {
      closed = true;
      if (hasExitEvent) {
        void finalize();
      }
    };

    child.stdout?.on("data", onStdout);
    child.stderr?.on("data", onStderr);
    child.once("error", onError);
    child.once("exit", onExit);
    child.once("close", onClose);

    if (hasInput && child.stdin) {
      child.stdin.on("error", () => {
        // Ignore EPIPE if the process exits before consuming stdin.
      });
      child.stdin.end(input ?? "");
    }

    abortSignal?.addEventListener("abort", abortListener, { once: true });

    timeoutTimer = setTimeout(() => {
      timedOut = true;
      if (typeof child.pid === "number") {
        killProcessTree(child.pid);
      } else {
        child.kill("SIGKILL");
      }
    }, timeoutMs);
    timeoutTimer.unref?.();
  });
}
