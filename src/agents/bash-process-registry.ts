import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { TaskAwaitingInput, TaskOutput, TaskOutputStatus } from "./task-output-contract.js";
import { killSession } from "./bash-tools.shared.js";
import {
  clearOwnedResourcesForTests,
  listOwnedResourcesForCurrentSession,
  registerOwnedResource,
  removeOwnedResource,
} from "./owned-resource-registry.js";
import {
  detectAwaitingInputFromTail,
  resolveProcessStallSettings,
} from "./process-stall-detector.js";
import { createSessionSlug as createSessionSlugId } from "./session-slug.js";
import {
  appendTaskTranscriptArtifact,
  ensureTaskTranscriptArtifact,
  writeTaskOutputArtifact,
} from "./task-output-artifacts.js";

const DEFAULT_JOB_TTL_MS = 30 * 60 * 1000; // 30 minutes
const MIN_JOB_TTL_MS = 60 * 1000; // 1 minute
const MAX_JOB_TTL_MS = 3 * 60 * 60 * 1000; // 3 hours
const DEFAULT_PENDING_OUTPUT_CHARS = 30_000;

function clampTtl(value: number | undefined) {
  if (!value || Number.isNaN(value)) {
    return DEFAULT_JOB_TTL_MS;
  }
  return Math.min(Math.max(value, MIN_JOB_TTL_MS), MAX_JOB_TTL_MS);
}

let jobTtlMs = clampTtl(Number.parseInt(process.env.PI_BASH_JOB_TTL_MS ?? "", 10));

export type ProcessStatus = "running" | "completed" | "failed" | "killed";
export type ProcessTerminalReason = "completed" | "error" | "cancelled" | "timeout";

export type SessionStdin = {
  write: (data: string, cb?: (err?: Error | null) => void) => void;
  end: () => void;
  destroyed?: boolean;
};

export interface ProcessSession {
  id: string;
  command: string;
  description?: string;
  scopeKey?: string;
  sessionKey?: string;
  notifyOnExit?: boolean;
  exitNotified?: boolean;
  child?: ChildProcessWithoutNullStreams;
  stdin?: SessionStdin;
  pid?: number;
  startedAt: number;
  cwd?: string;
  maxOutputChars: number;
  pendingMaxOutputChars?: number;
  totalOutputChars: number;
  pendingStdout: string[];
  pendingStderr: string[];
  pendingStdoutChars: number;
  pendingStderrChars: number;
  stdout?: string;
  stderr?: string;
  aggregated: string;
  tail: string;
  exitCode?: number | null;
  exitSignal?: NodeJS.Signals | number | null;
  terminalReason?: ProcessTerminalReason;
  error?: string;
  outputPath?: string;
  transcriptPath?: string;
  notified?: boolean;
  awaitingInput?: TaskAwaitingInput;
  lastOutputAt?: number;
  exited: boolean;
  truncated: boolean;
  backgrounded: boolean;
}

export interface FinishedSession {
  id: string;
  command: string;
  scopeKey?: string;
  sessionKey?: string;
  startedAt: number;
  endedAt: number;
  cwd?: string;
  status: ProcessStatus;
  exitCode?: number | null;
  exitSignal?: NodeJS.Signals | number | null;
  stdout?: string;
  stderr?: string;
  aggregated: string;
  tail: string;
  terminalReason?: ProcessTerminalReason;
  error?: string;
  outputPath?: string;
  transcriptPath?: string;
  notified?: boolean;
  awaitingInput?: TaskAwaitingInput;
  truncated: boolean;
  totalOutputChars: number;
}

const runningSessions = new Map<string, ProcessSession>();
const finishedSessions = new Map<string, FinishedSession>();
const terminalWaiters = new Map<string, Set<() => void>>();

let sweeper: NodeJS.Timeout | null = null;

function isSessionIdTaken(id: string) {
  return runningSessions.has(id) || finishedSessions.has(id);
}

export function createSessionSlug(): string {
  return createSessionSlugId(isSessionIdTaken);
}

export function addSession(session: ProcessSession) {
  session.pendingStdout ??= [];
  session.pendingStderr ??= [];
  session.pendingStdoutChars ??= sumPendingChars(session.pendingStdout);
  session.pendingStderrChars ??= sumPendingChars(session.pendingStderr);
  session.stdout ??= "";
  session.stderr ??= "";
  session.description ??= session.command;
  session.notified ??= false;
  session.lastOutputAt ??= session.startedAt;
  if (session.sessionKey?.trim()) {
    registerOwnedResource({
      resourceId: session.id,
      resourceType: "process_session",
      createdByTool: "exec",
      sessionKey: session.sessionKey,
      originalContext: {
        cwd: session.cwd,
        projectRoot: session.cwd,
        taskId: session.id,
      },
      cleanupStrategy: "process.clear|process.remove",
      createdAt: session.startedAt,
      metadata: {
        command: session.command,
      },
    });
  }
  syncProcessTaskArtifact(session);
  runningSessions.set(session.id, session);
  startSweeper();
}

export function getSession(id: string) {
  return runningSessions.get(id);
}

export function getFinishedSession(id: string) {
  return finishedSessions.get(id);
}

export function deleteSession(id: string) {
  runningSessions.delete(id);
  finishedSessions.delete(id);
  removeOwnedResource({
    resourceType: "process_session",
    resourceId: id,
  });
  notifyTerminalWaiters(id);
}

export function appendOutput(session: ProcessSession, stream: "stdout" | "stderr", chunk: string) {
  session.pendingStdout ??= [];
  session.pendingStderr ??= [];
  session.pendingStdoutChars ??= sumPendingChars(session.pendingStdout);
  session.pendingStderrChars ??= sumPendingChars(session.pendingStderr);
  const buffer = stream === "stdout" ? session.pendingStdout : session.pendingStderr;
  const bufferChars = stream === "stdout" ? session.pendingStdoutChars : session.pendingStderrChars;
  const pendingCap = Math.min(
    session.pendingMaxOutputChars ?? DEFAULT_PENDING_OUTPUT_CHARS,
    session.maxOutputChars,
  );
  buffer.push(chunk);
  let pendingChars = bufferChars + chunk.length;
  if (pendingChars > pendingCap) {
    session.truncated = true;
    pendingChars = capPendingBuffer(buffer, pendingChars, pendingCap);
  }
  if (stream === "stdout") {
    session.pendingStdoutChars = pendingChars;
  } else {
    session.pendingStderrChars = pendingChars;
  }
  session.totalOutputChars += chunk.length;
  session.lastOutputAt = Date.now();
  if (session.awaitingInput) {
    session.awaitingInput = undefined;
  }
  const streamText = trimWithCap(
    ((stream === "stdout" ? session.stdout : session.stderr) ?? "") + chunk,
    session.maxOutputChars,
  );
  if (stream === "stdout") {
    session.stdout = streamText;
  } else {
    session.stderr = streamText;
  }
  const aggregated = trimWithCap(session.aggregated + chunk, session.maxOutputChars);
  session.truncated =
    session.truncated || aggregated.length < session.aggregated.length + chunk.length;
  session.aggregated = aggregated;
  session.tail = tail(session.aggregated, 2000);
  appendTaskTranscriptArtifact({
    transcriptPath: session.transcriptPath,
    event: {
      type: stream,
      task_id: session.id,
      task_type: "shell",
      ts: Date.now(),
      chunk,
    },
  });
  syncProcessTaskArtifact(session);
}

export function drainSession(session: ProcessSession) {
  const stdout = session.pendingStdout.join("");
  const stderr = session.pendingStderr.join("");
  session.pendingStdout = [];
  session.pendingStderr = [];
  session.pendingStdoutChars = 0;
  session.pendingStderrChars = 0;
  return { stdout, stderr };
}

export function markExited(
  session: ProcessSession,
  exitCode: number | null,
  exitSignal: NodeJS.Signals | number | null,
  status: ProcessStatus,
  meta?: {
    terminalReason?: ProcessTerminalReason;
    error?: string;
  },
) {
  session.exited = true;
  session.exitCode = exitCode;
  session.exitSignal = exitSignal;
  session.terminalReason = meta?.terminalReason ?? session.terminalReason;
  session.error = meta?.error ?? session.error;
  session.tail = tail(session.aggregated, 2000);
  appendTaskTranscriptArtifact({
    transcriptPath: session.transcriptPath,
    event: {
      type: "exit",
      task_id: session.id,
      task_type: "shell",
      ts: Date.now(),
      status,
      terminal_reason: session.terminalReason,
      exit_code: exitCode,
      exit_signal: exitSignal,
      error: session.error,
    },
  });
  moveToFinished(session, status);
  notifyTerminalWaiters(session.id);
}

export function markBackgrounded(session: ProcessSession) {
  session.backgrounded = true;
  syncProcessTaskArtifact(session);
}

function moveToFinished(session: ProcessSession, status: ProcessStatus) {
  runningSessions.delete(session.id);
  if (!session.backgrounded) {
    return;
  }
  const finished: FinishedSession = {
    id: session.id,
    command: session.command,
    scopeKey: session.scopeKey,
    sessionKey: session.sessionKey,
    startedAt: session.startedAt,
    endedAt: Date.now(),
    cwd: session.cwd,
    status,
    exitCode: session.exitCode,
    exitSignal: session.exitSignal,
    stdout: session.stdout,
    stderr: session.stderr,
    aggregated: session.aggregated,
    tail: session.tail,
    terminalReason: session.terminalReason,
    error: session.error,
    outputPath: session.outputPath,
    transcriptPath: session.transcriptPath,
    notified: session.notified,
    awaitingInput: session.awaitingInput,
    truncated: session.truncated,
    totalOutputChars: session.totalOutputChars,
  };
  finishedSessions.set(session.id, finished);
  syncFinishedTaskArtifact(finished);
}

export function tail(text: string, max = 2000) {
  if (text.length <= max) {
    return text;
  }
  return text.slice(text.length - max);
}

function sumPendingChars(buffer: string[]) {
  let total = 0;
  for (const chunk of buffer) {
    total += chunk.length;
  }
  return total;
}

function capPendingBuffer(buffer: string[], pendingChars: number, cap: number) {
  if (pendingChars <= cap) {
    return pendingChars;
  }
  const last = buffer.at(-1);
  if (last && last.length >= cap) {
    buffer.length = 0;
    buffer.push(last.slice(last.length - cap));
    return cap;
  }
  while (buffer.length && pendingChars - buffer[0].length >= cap) {
    pendingChars -= buffer[0].length;
    buffer.shift();
  }
  if (buffer.length && pendingChars > cap) {
    const overflow = pendingChars - cap;
    buffer[0] = buffer[0].slice(overflow);
    pendingChars = cap;
  }
  return pendingChars;
}

export function trimWithCap(text: string, max: number) {
  if (text.length <= max) {
    return text;
  }
  return text.slice(text.length - max);
}

export function listRunningSessions() {
  return Array.from(runningSessions.values()).filter((s) => s.backgrounded);
}

export function listFinishedSessions() {
  return Array.from(finishedSessions.values());
}

export function clearFinished() {
  for (const id of finishedSessions.keys()) {
    removeOwnedResource({
      resourceType: "process_session",
      resourceId: id,
    });
  }
  finishedSessions.clear();
}

export function setSessionNotified(id: string, notified = true) {
  const running = runningSessions.get(id);
  if (running) {
    running.notified = notified;
    syncProcessTaskArtifact(running);
    return true;
  }
  const finished = finishedSessions.get(id);
  if (finished) {
    finished.notified = notified;
    syncFinishedTaskArtifact(finished);
    return true;
  }
  return false;
}

export async function waitForSessionTerminal(params: {
  id: string;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<FinishedSession | null> {
  const cached = getFinishedSession(params.id);
  if (cached) {
    return cached;
  }
  if (!getSession(params.id)) {
    return null;
  }
  if (params.timeoutMs <= 0) {
    return null;
  }
  return await new Promise((resolve) => {
    let settled = false;
    const finish = (value: FinishedSession | null) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      params.signal?.removeEventListener("abort", onAbort);
      waiters?.delete(onUpdate);
      if (waiters && waiters.size === 0) {
        terminalWaiters.delete(params.id);
      }
      resolve(value);
    };
    const onAbort = () => finish(null);
    const onUpdate = () => {
      const finished = getFinishedSession(params.id);
      if (finished) {
        finish(finished);
      }
    };
    const waiters = terminalWaiters.get(params.id) ?? new Set<() => void>();
    waiters.add(onUpdate);
    terminalWaiters.set(params.id, waiters);
    const timer = setTimeout(() => finish(null), Math.max(1, Math.floor(params.timeoutMs)));
    if (params.signal?.aborted) {
      finish(null);
      return;
    }
    params.signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function notifyTerminalWaiters(id: string) {
  const waiters = terminalWaiters.get(id);
  if (!waiters || waiters.size === 0) {
    return;
  }
  for (const waiter of waiters) {
    waiter();
  }
}

function resolveTaskOutputStatus(params: {
  exited: boolean;
  terminalReason?: ProcessTerminalReason;
  awaitingInput?: TaskAwaitingInput;
}): TaskOutputStatus {
  if (!params.exited) {
    return params.awaitingInput ? "awaiting_input" : "running";
  }
  switch (params.terminalReason) {
    case "completed":
      return "success";
    case "timeout":
      return "timeout";
    case "cancelled":
      return "cancelled";
    default:
      return "error";
  }
}

export function buildTaskOutputFromProcessSession(session: ProcessSession): TaskOutput {
  return {
    task_id: session.id,
    task_type: "shell",
    status: resolveTaskOutputStatus({
      exited: session.exited,
      terminalReason: session.terminalReason,
      awaitingInput: session.awaitingInput,
    }),
    description: session.description ?? session.command,
    output_path: session.outputPath,
    transcript_path: session.transcriptPath,
    stdout: session.stdout ?? "",
    stderr: session.stderr ?? "",
    exit_code: session.exited ? (session.exitCode ?? null) : undefined,
    error: session.error,
    prompt: session.command,
    notified: session.notified ?? false,
    awaiting_input: session.awaitingInput,
  };
}

export function buildTaskOutputFromFinishedSession(session: FinishedSession): TaskOutput {
  return {
    task_id: session.id,
    task_type: "shell",
    status: resolveTaskOutputStatus({
      exited: true,
      terminalReason: session.terminalReason,
    }),
    description: session.command,
    output_path: session.outputPath,
    transcript_path: session.transcriptPath,
    stdout: session.stdout ?? "",
    stderr: session.stderr ?? "",
    exit_code: session.exitCode ?? null,
    error: session.error,
    prompt: session.command,
    notified: session.notified ?? false,
    awaiting_input: session.awaitingInput,
  };
}

function syncProcessTaskArtifact(session: ProcessSession) {
  if (!session.outputPath && !session.transcriptPath) {
    return;
  }
  const taskOutput = buildTaskOutputFromProcessSession(session);
  ensureTaskTranscriptArtifact({
    transcriptPath: session.transcriptPath,
    header: {
      type: "task_header",
      task_id: session.id,
      task_type: "shell",
      started_at: session.startedAt,
      command: session.command,
      description: session.description ?? session.command,
      cwd: session.cwd,
    },
  });
  appendTaskTranscriptArtifact({
    transcriptPath: session.transcriptPath,
    event: {
      type: "snapshot",
      ts: Date.now(),
      task: taskOutput,
    },
  });
  writeTaskOutputArtifact(taskOutput);
}

function syncFinishedTaskArtifact(session: FinishedSession) {
  if (!session.outputPath && !session.transcriptPath) {
    return;
  }
  const taskOutput = buildTaskOutputFromFinishedSession(session);
  if (session.transcriptPath) {
    appendTaskTranscriptArtifact({
      transcriptPath: session.transcriptPath,
      event: {
        type: "snapshot",
        ts: Date.now(),
        task: taskOutput,
      },
    });
  }
  writeTaskOutputArtifact(taskOutput);
}

export function resetProcessRegistryForTests() {
  runningSessions.clear();
  finishedSessions.clear();
  terminalWaiters.clear();
  clearOwnedResourcesForTests("process_session");
  stopSweeper();
}

function maybeMarkAwaitingInput(session: ProcessSession, now = Date.now()) {
  if (!session.backgrounded || session.exited || session.awaitingInput) {
    return false;
  }
  const stallSettings = resolveProcessStallSettings();
  const lastOutputAt = session.lastOutputAt ?? session.startedAt;
  if (now - lastOutputAt < stallSettings.thresholdMs) {
    return false;
  }
  const detected = detectAwaitingInputFromTail(session.tail || session.aggregated || "", now);
  if (!detected) {
    return false;
  }
  session.awaitingInput = detected;
  syncProcessTaskArtifact(session);
  return true;
}

function sweepRunningSessions(now = Date.now()) {
  for (const session of runningSessions.values()) {
    maybeMarkAwaitingInput(session, now);
  }
}

export function sweepProcessRegistryForTests(now = Date.now()) {
  sweepRunningSessions(now);
  pruneFinishedSessions();
}

export function stopOwnedProcessSessions(params: { sessionKey: string; reason?: string }) {
  const sessionKey = params.sessionKey.trim();
  if (!sessionKey) {
    return { stopped: 0 };
  }
  let stopped = 0;
  for (const entry of listOwnedResourcesForCurrentSession({
    sessionKey,
    resourceType: "process_session",
  })) {
    const session = runningSessions.get(entry.resourceId);
    if (!session || session.exited) {
      continue;
    }
    killSession(session);
    markExited(session, null, "SIGKILL", "failed", {
      terminalReason: "cancelled",
      error: params.reason ?? "Process stopped because the parent session exited.",
    });
    stopped += 1;
  }
  return { stopped };
}

export function setJobTtlMs(value?: number) {
  if (value === undefined || Number.isNaN(value)) {
    return;
  }
  jobTtlMs = clampTtl(value);
  stopSweeper();
  startSweeper();
}

function pruneFinishedSessions() {
  const cutoff = Date.now() - jobTtlMs;
  for (const [id, session] of finishedSessions.entries()) {
    if (session.endedAt < cutoff) {
      finishedSessions.delete(id);
      removeOwnedResource({
        resourceType: "process_session",
        resourceId: id,
      });
    }
  }
}

function startSweeper() {
  if (sweeper) {
    return;
  }
  const stallSettings = resolveProcessStallSettings();
  sweeper = setInterval(
    () => {
      const now = Date.now();
      sweepRunningSessions(now);
      pruneFinishedSessions();
    },
    Math.max(1_000, Math.min(stallSettings.checkIntervalMs, Math.max(30_000, jobTtlMs / 6))),
  );
  sweeper.unref?.();
}

function stopSweeper() {
  if (!sweeper) {
    return;
  }
  clearInterval(sweeper);
  sweeper = null;
}
