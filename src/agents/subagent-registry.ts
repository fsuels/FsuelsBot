import path from "node:path";
import type { SandboxToolPolicy } from "./sandbox.js";
import type { SubagentCapabilityProfileId } from "./subagent-policy.js";
import type { TaskOutput, TaskOutputStatus } from "./task-output-contract.js";
import { loadConfig } from "../config/config.js";
import { loadSessionStore, resolveStorePath } from "../config/sessions.js";
import { callGateway } from "../gateway/call.js";
import { onAgentEvent } from "../infra/agent-events.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { resolveAgentIdFromSessionKey } from "../routing/session-key.js";
import { type DeliveryContext, normalizeDeliveryContext } from "../utils/delivery-context.js";
import { isEmbeddedPiRunActive } from "./pi-embedded.js";
import {
  runSubagentAnnounceFlowDetailed,
  type SubagentCleanupTransitionResult,
  type SubagentRunOutcome,
} from "./subagent-announce.js";
import {
  loadSubagentRegistryFromDisk,
  saveSubagentRegistryToDisk,
} from "./subagent-registry.store.js";
import {
  clearOwnedResourcesForTests,
  registerOwnedResource,
  removeOwnedResource,
} from "./owned-resource-registry.js";
import { resolveTaskOutputPath, writeTaskOutputArtifact } from "./task-output-artifacts.js";
import { resolveAgentTimeoutMs } from "./timeout.js";
import { readLatestAssistantReply } from "./tools/agent-step.js";

export type SubagentRunRecord = {
  runId: string;
  childSessionKey: string;
  requesterSessionKey: string;
  requesterOrigin?: DeliveryContext;
  requesterDisplayKey: string;
  task: string;
  cleanup: "delete" | "keep";
  label?: string;
  profile?: SubagentCapabilityProfileId;
  requiredTools?: string[];
  sessionToolPolicy?: SandboxToolPolicy;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  outcome?: SubagentRunOutcome;
  archiveAtMs?: number;
  cleanupCompletedAt?: number;
  cleanupHandled?: boolean;
  cleanupState?: "pending" | "completed" | "blocked" | "failed";
  cleanupReason?: string;
  cleanupError?: string;
  cleanupAttempts?: number;
  cleanupLastAttemptAt?: number;
  outputPath?: string;
  transcriptPath?: string;
  finalText?: string;
  notified?: boolean;
};

const subagentRuns = new Map<string, SubagentRunRecord>();
let sweeper: NodeJS.Timeout | null = null;
let listenerStarted = false;
let listenerStop: (() => void) | null = null;
const cleanupTransitions = new Map<string, Promise<void>>();
const taskWaiters = new Map<string, Set<() => void>>();
// Use var to avoid TDZ when init runs across circular imports during bootstrap.
var restoreAttempted = false;
const SUBAGENT_ANNOUNCE_TIMEOUT_MS = 120_000;
const log = createSubsystemLogger("agents/subagent-cleanup");

function persistSubagentRuns() {
  try {
    saveSubagentRegistryToDisk(subagentRuns);
  } catch {
    // ignore persistence failures
  }
}

const resumedRuns = new Set<string>();

function logCleanupEvent(
  level: "debug" | "warn" | "error",
  event: string,
  entry: Pick<SubagentRunRecord, "runId" | "childSessionKey" | "requesterSessionKey" | "cleanup">,
  meta?: Record<string, unknown>,
) {
  const message = `subagent cleanup ${event}: runId=${entry.runId} child=${entry.childSessionKey}`;
  log[level](message, {
    event,
    runId: entry.runId,
    childSessionKey: entry.childSessionKey,
    requesterSessionKey: entry.requesterSessionKey,
    cleanup: entry.cleanup,
    ...meta,
  });
}

async function withCleanupTransition(runId: string, task: () => Promise<void>) {
  const existing = cleanupTransitions.get(runId);
  if (existing) {
    return existing;
  }
  let promise: Promise<void>;
  promise = (async () => {
    try {
      await task();
    } finally {
      if (cleanupTransitions.get(runId) === promise) {
        cleanupTransitions.delete(runId);
      }
    }
  })();
  cleanupTransitions.set(runId, promise);
  return promise;
}

function forgetSubagentRun(runId: string) {
  const existing = subagentRuns.get(runId);
  const didDelete = subagentRuns.delete(runId);
  resumedRuns.delete(runId);
  cleanupTransitions.delete(runId);
  if (existing) {
    removeOwnedResource({
      resourceType: "subagent_session",
      resourceId: existing.childSessionKey,
    });
  }
  if (didDelete) {
    persistSubagentRuns();
  }
  notifyTaskWaiters(runId);
  if (subagentRuns.size === 0) {
    stopSweeper();
  }
}

function resolveChildSessionId(childSessionKey: string): string | undefined {
  const cfg = loadConfig();
  const agentId = resolveAgentIdFromSessionKey(childSessionKey);
  const storePath = resolveStorePath(cfg.session?.store, { agentId });
  const entry = loadSessionStore(storePath)[childSessionKey];
  if (!entry || typeof entry.sessionId !== "string") {
    return undefined;
  }
  const sessionId = entry.sessionId.trim();
  return sessionId || undefined;
}

function resolveChildTranscriptPath(childSessionKey: string): string | undefined {
  const cfg = loadConfig();
  const agentId = resolveAgentIdFromSessionKey(childSessionKey);
  const storePath = resolveStorePath(cfg.session?.store, { agentId });
  const entry = loadSessionStore(storePath)[childSessionKey];
  const sessionId =
    entry && typeof entry.sessionId === "string" ? entry.sessionId.trim() : undefined;
  if (!storePath || !sessionId) {
    return undefined;
  }
  return path.join(path.dirname(storePath), `${sessionId}.jsonl`);
}

function resolveSubagentTaskStatus(entry: SubagentRunRecord): TaskOutputStatus {
  switch (entry.outcome?.status) {
    case "ok":
      return "success";
    case "timeout":
      return "timeout";
    case "error":
      return "error";
    default:
      return entry.startedAt ? "running" : "pending";
  }
}

export function buildTaskOutputFromSubagentRun(entry: SubagentRunRecord): TaskOutput {
  return {
    task_id: entry.runId,
    task_type: "agent",
    status: resolveSubagentTaskStatus(entry),
    description: entry.label?.trim() || entry.task,
    output_path: entry.outputPath,
    transcript_path: entry.transcriptPath,
    final_text: entry.finalText,
    error: entry.outcome?.error,
    prompt: entry.task,
    notified: entry.notified ?? false,
  };
}

function syncSubagentTaskArtifact(entry: SubagentRunRecord) {
  entry.outputPath ??= resolveTaskOutputPath({ taskId: entry.runId, taskType: "agent" });
  entry.transcriptPath ??= resolveChildTranscriptPath(entry.childSessionKey);
  entry.notified ??= false;
  writeTaskOutputArtifact(buildTaskOutputFromSubagentRun(entry));
}

function persistAndSyncSubagentRun(runId: string) {
  persistSubagentRuns();
  const entry = subagentRuns.get(runId);
  if (entry) {
    syncSubagentTaskArtifact(entry);
  }
  notifyTaskWaiters(runId);
}

function notifyTaskWaiters(runId: string) {
  const waiters = taskWaiters.get(runId);
  if (!waiters || waiters.size === 0) {
    return;
  }
  for (const waiter of waiters) {
    waiter();
  }
}

function markCleanupPending(entry: SubagentRunRecord) {
  entry.cleanupHandled = true;
  entry.cleanupState = "pending";
  entry.cleanupReason = undefined;
  entry.cleanupError = undefined;
  entry.cleanupAttempts = (entry.cleanupAttempts ?? 0) + 1;
  entry.cleanupLastAttemptAt = Date.now();
}

function scheduleSubagentCleanup(runId: string, source: "resume" | "lifecycle" | "wait") {
  const entry = subagentRuns.get(runId);
  if (!entry || entry.cleanupCompletedAt) {
    return;
  }
  logCleanupEvent("debug", "cleanup_requested", entry, { source });
  void withCleanupTransition(runId, async () => {
    const current = subagentRuns.get(runId);
    if (!current || current.cleanupCompletedAt || current.cleanupHandled) {
      return;
    }
    markCleanupPending(current);
    persistAndSyncSubagentRun(runId);
    logCleanupEvent("debug", "cleanup_started", current, {
      source,
      cleanupAttempt: current.cleanupAttempts,
    });
    const requesterOrigin = normalizeDeliveryContext(current.requesterOrigin);
    const result = await runSubagentAnnounceFlowDetailed({
      childSessionKey: current.childSessionKey,
      childRunId: current.runId,
      requesterSessionKey: current.requesterSessionKey,
      requesterOrigin,
      requesterDisplayKey: current.requesterDisplayKey,
      task: current.task,
      timeoutMs: SUBAGENT_ANNOUNCE_TIMEOUT_MS,
      cleanup: current.cleanup,
      waitForCompletion: false,
      startedAt: current.startedAt,
      endedAt: current.endedAt,
      label: current.label,
      outcome: current.outcome,
      announceType: "subagent task",
    });
    finalizeSubagentCleanup(runId, current.cleanup, result);
  });
}

function resumeSubagentRun(runId: string) {
  if (!runId || resumedRuns.has(runId)) {
    return;
  }
  const entry = subagentRuns.get(runId);
  if (!entry) {
    return;
  }
  if (entry.cleanupCompletedAt) {
    return;
  }

  if (typeof entry.endedAt === "number" && entry.endedAt > 0) {
    scheduleSubagentCleanup(runId, "resume");
    resumedRuns.add(runId);
    return;
  }

  // Wait for completion again after restart.
  const cfg = loadConfig();
  const waitTimeoutMs = resolveSubagentWaitTimeoutMs(cfg, undefined);
  void waitForSubagentCompletion(runId, waitTimeoutMs);
  resumedRuns.add(runId);
}

function restoreSubagentRunsOnce() {
  if (restoreAttempted) {
    return;
  }
  restoreAttempted = true;
  try {
    const restored = loadSubagentRegistryFromDisk();
    if (restored.size === 0) {
      return;
    }
    let mutated = false;
    for (const [runId, entry] of restored.entries()) {
      if (!runId || !entry) {
        continue;
      }
      if (entry.cleanupCompletedAt) {
        entry.cleanupState = "completed";
      } else {
        entry.cleanupState = entry.cleanupState ?? "pending";
      }
      if (entry.cleanupHandled && !entry.cleanupCompletedAt) {
        // A persisted in-flight flag means the previous process likely died mid-cleanup.
        // Reset it so teardown can be retried safely after restart.
        entry.cleanupHandled = false;
        mutated = true;
      }
      // Keep any newer in-memory entries.
      if (!subagentRuns.has(runId)) {
        subagentRuns.set(runId, entry);
      }
    }
    if (mutated) {
      persistSubagentRuns();
    }

    // Resume pending work.
    ensureListener();
    if ([...subagentRuns.values()].some((entry) => entry.archiveAtMs)) {
      startSweeper();
    }
    for (const runId of subagentRuns.keys()) {
      resumeSubagentRun(runId);
    }
  } catch {
    // ignore restore failures
  }
}

function resolveArchiveAfterMs(cfg?: ReturnType<typeof loadConfig>) {
  const config = cfg ?? loadConfig();
  const minutes = config.agents?.defaults?.subagents?.archiveAfterMinutes ?? 60;
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return undefined;
  }
  return Math.max(1, Math.floor(minutes)) * 60_000;
}

function resolveSubagentWaitTimeoutMs(
  cfg: ReturnType<typeof loadConfig>,
  runTimeoutSeconds?: number,
) {
  return resolveAgentTimeoutMs({ cfg, overrideSeconds: runTimeoutSeconds });
}

function startSweeper() {
  if (sweeper) {
    return;
  }
  sweeper = setInterval(() => {
    void sweepSubagentRuns();
  }, 60_000);
  sweeper.unref?.();
}

function stopSweeper() {
  if (!sweeper) {
    return;
  }
  clearInterval(sweeper);
  sweeper = null;
}

async function sweepSubagentRuns() {
  const now = Date.now();
  for (const [runId, entry] of [...subagentRuns.entries()]) {
    if (!entry.archiveAtMs || entry.archiveAtMs > now) {
      continue;
    }
    await withCleanupTransition(runId, async () => {
      const current = subagentRuns.get(runId);
      if (!current || !current.archiveAtMs || current.archiveAtMs > Date.now()) {
        return;
      }
      if (!current.cleanupCompletedAt || !current.endedAt) {
        current.cleanupState = "blocked";
        current.cleanupReason = "archive_waiting_for_cleanup";
        current.cleanupError = undefined;
        persistAndSyncSubagentRun(runId);
        return;
      }
      const childSessionId = resolveChildSessionId(current.childSessionKey);
      if (childSessionId && isEmbeddedPiRunActive(childSessionId)) {
        current.cleanupState = "blocked";
        current.cleanupReason = "active_run_still_processing";
        current.cleanupError = undefined;
        persistAndSyncSubagentRun(runId);
        logCleanupEvent("warn", "cleanup_blocked_active_run", current, {
          source: "archive",
          childSessionId,
        });
        return;
      }
      try {
        await callGateway({
          method: "sessions.delete",
          params: { key: current.childSessionKey, deleteTranscript: true },
          timeoutMs: 10_000,
        });
        logCleanupEvent("debug", "cleanup_completed", current, {
          source: "archive",
          childSessionId,
          archive: true,
        });
        forgetSubagentRun(runId);
      } catch (err) {
        current.cleanupState = "failed";
        current.cleanupReason = "archive_delete_failed";
        current.cleanupError = err instanceof Error ? err.message : String(err);
        persistAndSyncSubagentRun(runId);
        logCleanupEvent("error", "cleanup_failed", current, {
          source: "archive",
          archive: true,
          error: current.cleanupError,
        });
      }
    });
  }
  if (subagentRuns.size === 0) {
    stopSweeper();
  }
}

function ensureListener() {
  if (listenerStarted) {
    return;
  }
  listenerStarted = true;
  listenerStop = onAgentEvent((evt) => {
    if (!evt || evt.stream !== "lifecycle") {
      return;
    }
    const entry = subagentRuns.get(evt.runId);
    if (!entry) {
      return;
    }
    const phase = evt.data?.phase;
    if (phase === "start") {
      const startedAt = typeof evt.data?.startedAt === "number" ? evt.data.startedAt : undefined;
      if (startedAt) {
        entry.startedAt = startedAt;
        persistAndSyncSubagentRun(evt.runId);
      }
      return;
    }
    if (phase !== "end" && phase !== "error") {
      return;
    }
    const endedAt = typeof evt.data?.endedAt === "number" ? evt.data.endedAt : Date.now();
    entry.endedAt = endedAt;
    if (phase === "error") {
      const error = typeof evt.data?.error === "string" ? evt.data.error : undefined;
      entry.outcome = { status: "error", error };
    } else {
      entry.outcome = { status: "ok" };
    }
    persistAndSyncSubagentRun(evt.runId);
    scheduleSubagentCleanup(evt.runId, "lifecycle");
  });
}

function finalizeSubagentCleanup(
  runId: string,
  cleanup: "delete" | "keep",
  result: SubagentCleanupTransitionResult,
) {
  const entry = subagentRuns.get(runId);
  if (!entry) {
    return;
  }
  if (result.status === "blocked") {
    entry.cleanupHandled = false;
    entry.cleanupState = "blocked";
    entry.cleanupReason = result.reason;
    entry.cleanupError = result.error;
    persistAndSyncSubagentRun(runId);
    logCleanupEvent("warn", "cleanup_blocked_active_run", entry, {
      reason: result.reason,
      cleanupResult: result.childSessionCleanup,
    });
    return;
  }
  if (result.status === "failed") {
    entry.cleanupHandled = false;
    entry.cleanupState = "failed";
    entry.cleanupReason = result.reason;
    entry.cleanupError = result.error;
    persistAndSyncSubagentRun(runId);
    logCleanupEvent("error", "cleanup_failed", entry, {
      reason: result.reason,
      error: result.error,
      cleanupResult: result.childSessionCleanup,
    });
    return;
  }
  entry.cleanupState = "completed";
  entry.cleanupReason = result.reason;
  entry.cleanupError = undefined;
  if (cleanup === "delete") {
    logCleanupEvent("debug", "cleanup_completed", entry, {
      reason: result.reason,
      cleanupResult: result.childSessionCleanup,
    });
    forgetSubagentRun(runId);
    return;
  }
  entry.cleanupCompletedAt = Date.now();
  persistAndSyncSubagentRun(runId);
  logCleanupEvent("debug", "cleanup_completed", entry, {
    reason: result.reason,
    cleanupResult: result.childSessionCleanup,
  });
}

export function registerSubagentRun(params: {
  runId: string;
  childSessionKey: string;
  requesterSessionKey: string;
  requesterOrigin?: DeliveryContext;
  requesterDisplayKey: string;
  task: string;
  cleanup: "delete" | "keep";
  label?: string;
  profile?: SubagentCapabilityProfileId;
  requiredTools?: string[];
  sessionToolPolicy?: SandboxToolPolicy;
  runTimeoutSeconds?: number;
}) {
  const now = Date.now();
  const cfg = loadConfig();
  const archiveAfterMs = resolveArchiveAfterMs(cfg);
  const archiveAtMs = archiveAfterMs ? now + archiveAfterMs : undefined;
  const waitTimeoutMs = resolveSubagentWaitTimeoutMs(cfg, params.runTimeoutSeconds);
  const requesterOrigin = normalizeDeliveryContext(params.requesterOrigin);
  subagentRuns.set(params.runId, {
    runId: params.runId,
    childSessionKey: params.childSessionKey,
    requesterSessionKey: params.requesterSessionKey,
    requesterOrigin,
    requesterDisplayKey: params.requesterDisplayKey,
    task: params.task,
    cleanup: params.cleanup,
    label: params.label,
    profile: params.profile,
    requiredTools: params.requiredTools,
    sessionToolPolicy: params.sessionToolPolicy,
    createdAt: now,
    startedAt: now,
    archiveAtMs,
    cleanupHandled: false,
    cleanupState: "pending",
    cleanupAttempts: 0,
    outputPath: resolveTaskOutputPath({ taskId: params.runId, taskType: "agent" }),
    transcriptPath: resolveChildTranscriptPath(params.childSessionKey),
    finalText: undefined,
    notified: false,
  });
  registerOwnedResource({
    resourceId: params.childSessionKey,
    resourceType: "subagent_session",
    createdByTool: "sessions_spawn",
    sessionKey: params.requesterSessionKey,
    originalContext: {
      taskId: params.runId,
    },
    cleanupStrategy:
      params.cleanup === "delete" ? "sessions.delete child session after cleanup" : "keep child session",
    linkedSidecars: [params.runId],
    createdAt: now,
    metadata: {
      cleanup: params.cleanup,
      label: params.label,
      profile: params.profile,
    },
  });
  ensureListener();
  persistAndSyncSubagentRun(params.runId);
  if (archiveAfterMs) {
    startSweeper();
  }
  // Wait for subagent completion via gateway RPC (cross-process).
  // The in-process lifecycle listener is a fallback for embedded runs.
  void waitForSubagentCompletion(params.runId, waitTimeoutMs);
}

async function waitForSubagentCompletion(runId: string, waitTimeoutMs: number) {
  try {
    const timeoutMs = Math.max(1, Math.floor(waitTimeoutMs));
    const wait = await callGateway<{
      status?: string;
      startedAt?: number;
      endedAt?: number;
      error?: string;
    }>({
      method: "agent.wait",
      params: {
        runId,
        timeoutMs,
      },
      timeoutMs: timeoutMs + 10_000,
    });
    const entry = subagentRuns.get(runId);
    if (wait?.status === "timeout") {
      if (entry) {
        entry.cleanupState = "blocked";
        entry.cleanupReason = "run_still_active";
        entry.cleanupError = undefined;
        persistAndSyncSubagentRun(runId);
      }
      return;
    }
    if (wait?.status !== "ok" && wait?.status !== "error") {
      return;
    }
    if (!entry) {
      return;
    }
    let mutated = false;
    if (typeof wait.startedAt === "number") {
      entry.startedAt = wait.startedAt;
      mutated = true;
    }
    if (typeof wait.endedAt === "number") {
      entry.endedAt = wait.endedAt;
      mutated = true;
    }
    if (!entry.endedAt) {
      entry.endedAt = Date.now();
      mutated = true;
    }
    const waitError = typeof wait.error === "string" ? wait.error : undefined;
    entry.outcome =
      wait.status === "error" ? { status: "error", error: waitError } : { status: "ok" };
    mutated = true;
    const finalText = await readLatestAssistantReply({ sessionKey: entry.childSessionKey }).catch(
      () => undefined,
    );
    if (finalText?.trim()) {
      entry.finalText = finalText.trim();
      mutated = true;
    }
    if (mutated) {
      persistAndSyncSubagentRun(runId);
    }
    scheduleSubagentCleanup(runId, "wait");
  } catch (err) {
    const entry = subagentRuns.get(runId);
    if (entry) {
      entry.cleanupState = "failed";
      entry.cleanupReason = "wait_failed";
      entry.cleanupError = err instanceof Error ? err.message : String(err);
      persistAndSyncSubagentRun(runId);
    }
  }
}

export function resetSubagentRegistryForTests() {
  subagentRuns.clear();
  resumedRuns.clear();
  cleanupTransitions.clear();
  taskWaiters.clear();
  clearOwnedResourcesForTests("subagent_session");
  stopSweeper();
  restoreAttempted = false;
  if (listenerStop) {
    listenerStop();
    listenerStop = null;
  }
  listenerStarted = false;
  persistSubagentRuns();
}

export function addSubagentRunForTests(entry: SubagentRunRecord) {
  subagentRuns.set(entry.runId, entry);
  registerOwnedResource({
    resourceId: entry.childSessionKey,
    resourceType: "subagent_session",
    createdByTool: "sessions_spawn",
    sessionKey: entry.requesterSessionKey,
    originalContext: {
      taskId: entry.runId,
    },
    cleanupStrategy:
      entry.cleanup === "delete" ? "sessions.delete child session after cleanup" : "keep child session",
    linkedSidecars: [entry.runId],
    createdAt: entry.createdAt,
    metadata: {
      cleanup: entry.cleanup,
      label: entry.label,
      profile: entry.profile,
    },
  });
  persistAndSyncSubagentRun(entry.runId);
}

export function releaseSubagentRun(runId: string) {
  forgetSubagentRun(runId);
}

export function listSubagentRunsForRequester(requesterSessionKey: string): SubagentRunRecord[] {
  restoreSubagentRunsOnce();
  const key = requesterSessionKey.trim();
  if (!key) {
    return [];
  }
  return [...subagentRuns.values()].filter((entry) => entry.requesterSessionKey === key);
}

export function getSubagentRunBySessionKey(childSessionKey: string): SubagentRunRecord | undefined {
  restoreSubagentRunsOnce();
  const key = childSessionKey.trim();
  if (!key) {
    return undefined;
  }
  return [...subagentRuns.values()].find((entry) => entry.childSessionKey === key);
}

export function getSubagentRun(runId: string): SubagentRunRecord | undefined {
  restoreSubagentRunsOnce();
  const key = runId.trim();
  if (!key) {
    return undefined;
  }
  const entry = subagentRuns.get(key);
  if (!entry) {
    return undefined;
  }
  const transcriptPath = resolveChildTranscriptPath(entry.childSessionKey);
  if (transcriptPath && entry.transcriptPath !== transcriptPath) {
    entry.transcriptPath = transcriptPath;
    persistAndSyncSubagentRun(key);
  }
  return entry;
}

export function setSubagentRunFinalText(runId: string, finalText?: string) {
  const entry = getSubagentRun(runId);
  if (!entry) {
    return undefined;
  }
  const normalized = finalText?.trim();
  entry.finalText = normalized ? normalized : undefined;
  persistAndSyncSubagentRun(runId);
  return entry;
}

export function setSubagentRunNotified(runId: string, notified = true) {
  const entry = getSubagentRun(runId);
  if (!entry) {
    return false;
  }
  entry.notified = notified;
  persistAndSyncSubagentRun(runId);
  return true;
}

export async function waitForSubagentTerminal(params: {
  runId: string;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<SubagentRunRecord | null> {
  const existing = getSubagentRun(params.runId);
  if (!existing) {
    return null;
  }
  const status = resolveSubagentTaskStatus(existing);
  if (
    status === "success" ||
    status === "error" ||
    status === "cancelled" ||
    status === "timeout"
  ) {
    return existing;
  }
  if (params.timeoutMs <= 0) {
    return existing;
  }
  return await new Promise((resolve) => {
    let settled = false;
    const finish = (value: SubagentRunRecord | null) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      params.signal?.removeEventListener("abort", onAbort);
      waiters?.delete(onUpdate);
      if (waiters && waiters.size === 0) {
        taskWaiters.delete(params.runId);
      }
      resolve(value);
    };
    const onAbort = () => finish(getSubagentRun(params.runId) ?? null);
    const onUpdate = () => {
      const next = getSubagentRun(params.runId);
      if (!next) {
        finish(null);
        return;
      }
      const nextStatus = resolveSubagentTaskStatus(next);
      if (
        nextStatus === "success" ||
        nextStatus === "error" ||
        nextStatus === "cancelled" ||
        nextStatus === "timeout"
      ) {
        finish(next);
      }
    };
    const waiters = taskWaiters.get(params.runId) ?? new Set<() => void>();
    waiters.add(onUpdate);
    taskWaiters.set(params.runId, waiters);
    const timer = setTimeout(
      () => finish(getSubagentRun(params.runId) ?? null),
      Math.max(1, Math.floor(params.timeoutMs)),
    );
    if (params.signal?.aborted) {
      onAbort();
      return;
    }
    params.signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function initSubagentRegistry() {
  restoreSubagentRunsOnce();
}

export async function sweepSubagentRunsForTests() {
  await sweepSubagentRuns();
}
