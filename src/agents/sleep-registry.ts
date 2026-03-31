import crypto from "node:crypto";
import type { OpenClawConfig } from "../config/config.js";
import { loadConfig } from "../config/config.js";
import { readSessionUpdatedAt, resolveStorePath } from "../config/sessions.js";
import { callGateway } from "../gateway/call.js";
import { hasSystemEvents } from "../infra/system-events.js";
import { resolveAgentIdFromSessionKey } from "../routing/session-key.js";
import { INTERNAL_MESSAGE_CHANNEL } from "../utils/message-channel.js";
import { clampWithDefault, readEnvInt } from "./bash-tools.shared.js";
import { AGENT_LANE_NESTED } from "./lanes.js";
import {
  computeEffectiveSettings,
  DEFAULT_CONTEXT_PRUNING_SETTINGS,
} from "./pi-extensions/context-pruning/settings.js";
import { listActionableRuntimeTaskIds } from "./task-runtime.js";

const DEFAULT_SLEEP_MAX_MS = 12 * 60 * 60 * 1000;
const DEFAULT_SHORT_WAIT_MS = 60_000;
const DEFAULT_LONG_WAIT_MS = 15 * 60_000;
const DEFAULT_MEDIUM_TICK_MS = 60_000;
const DEFAULT_LONG_TICK_MS = 5 * 60_000;
const DEFAULT_WAKE_RETRY_MS = 1_000;
const MAX_WAKE_RETRIES = 3;

export type SleepWakeKind = "time" | "tick" | "system-event" | "task-result";

export type SleepHeuristics = {
  cacheTtlMs: number;
  maxSleepMs: number;
  shortWaitMs: number;
  longWaitMs: number;
  tickIntervalMs: number;
  longTickIntervalMs: number;
};

export type SleepRegistration = {
  sleepId: string;
  scheduledAt: number;
  requestedWakeAt: number;
  wakeAt: number;
  requestedDurationMs: number;
  durationMs: number;
  clamped: boolean;
  tickIntervalMs?: number;
  heuristics: SleepHeuristics;
  persistence: "memory_only";
};

type SleepEntry = SleepRegistration & {
  sessionKey: string;
  reason?: string;
  interruptible: boolean;
  timer: NodeJS.Timeout | null;
  retries: number;
};

type WakeDecision = {
  kind: SleepWakeKind;
  pendingTaskIds: string[];
};

const pendingSleeps = new Map<string, SleepEntry>();

function clearSleepTimer(entry: SleepEntry) {
  if (!entry.timer) {
    return;
  }
  clearTimeout(entry.timer);
  entry.timer = null;
}

function removeSleep(id: string) {
  const entry = pendingSleeps.get(id);
  if (!entry) {
    return false;
  }
  clearSleepTimer(entry);
  pendingSleeps.delete(id);
  return true;
}

function removeSleepForSession(sessionKey: string) {
  const trimmed = sessionKey.trim();
  if (!trimmed) {
    return;
  }
  for (const [id, entry] of pendingSleeps.entries()) {
    if (entry.sessionKey === trimmed) {
      removeSleep(id);
    }
  }
}

function getSessionUpdatedAt(sessionKey: string, config?: OpenClawConfig): number | undefined {
  const trimmed = sessionKey.trim();
  if (!trimmed) {
    return undefined;
  }
  const cfg = config ?? loadConfig();
  const storePath = resolveStorePath(cfg.session?.store, {
    agentId: resolveAgentIdFromSessionKey(trimmed),
  });
  return readSessionUpdatedAt({
    storePath,
    sessionKey: trimmed,
  });
}

function collectPendingTaskIds(sessionKey: string) {
  return listActionableRuntimeTaskIds({ requesterSessionKey: sessionKey }).toSorted();
}

function buildWakePrompt(entry: SleepEntry, decision: WakeDecision) {
  const lines = [
    "You were resumed from the `sleep` tool.",
    entry.reason ? `Original sleep reason: ${entry.reason}` : "",
    decision.kind === "time"
      ? "The requested sleep duration has elapsed."
      : decision.kind === "tick"
        ? "This is a periodic sleep check-in before the requested wake deadline."
        : decision.kind === "system-event"
          ? "System events are pending for this session."
          : "Background task results are now available for this session.",
    decision.pendingTaskIds.length > 0
      ? `Pending background task ids: ${decision.pendingTaskIds.join(", ")}`
      : "",
    decision.kind === "tick"
      ? [
          "Before sleeping again, reevaluate whether there is useful work to do now.",
          "Check pending system events, then use `get_task_output` for any completed background shell or sub-agent tasks you still care about.",
          "If there is still nothing useful to do, call `sleep` again for the remaining time instead of using shell sleep.",
        ].join("\n")
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  return lines;
}

async function wakeSleep(entry: SleepEntry, decision: WakeDecision) {
  if (!pendingSleeps.has(entry.sleepId)) {
    return;
  }
  if (entry.interruptible && (getSessionUpdatedAt(entry.sessionKey) ?? 0) > entry.scheduledAt) {
    removeSleep(entry.sleepId);
    return;
  }

  const idempotencyKey = crypto.randomUUID();
  try {
    await callGateway({
      method: "agent",
      params: {
        message:
          decision.kind === "tick"
            ? "Periodic sleep check-in."
            : decision.kind === "time"
              ? "Scheduled sleep finished."
              : "Scheduled sleep woke early.",
        sessionKey: entry.sessionKey,
        idempotencyKey,
        deliver: false,
        channel: INTERNAL_MESSAGE_CHANNEL,
        lane: AGENT_LANE_NESTED,
        extraSystemPrompt: buildWakePrompt(entry, decision),
      },
      timeoutMs: 10_000,
    });
    removeSleep(entry.sleepId);
  } catch {
    entry.retries += 1;
    if (entry.retries > MAX_WAKE_RETRIES) {
      removeSleep(entry.sleepId);
      return;
    }
    scheduleSleepCheck(entry, DEFAULT_WAKE_RETRY_MS);
  }
}

function buildWakeDecision(entry: SleepEntry): WakeDecision {
  const pendingTaskIds = collectPendingTaskIds(entry.sessionKey);
  if (pendingTaskIds.length > 0) {
    return {
      kind: "task-result",
      pendingTaskIds,
    };
  }
  if (hasSystemEvents(entry.sessionKey)) {
    return {
      kind: "system-event",
      pendingTaskIds: [],
    };
  }
  if (Date.now() >= entry.wakeAt) {
    return {
      kind: "time",
      pendingTaskIds: [],
    };
  }
  return {
    kind: "tick",
    pendingTaskIds: [],
  };
}

async function runSleepCheck(sleepId: string) {
  const entry = pendingSleeps.get(sleepId);
  if (!entry) {
    return;
  }
  entry.timer = null;
  if (entry.interruptible && (getSessionUpdatedAt(entry.sessionKey) ?? 0) > entry.scheduledAt) {
    removeSleep(entry.sleepId);
    return;
  }

  const decision = buildWakeDecision(entry);
  if (decision.kind === "tick") {
    await wakeSleep(entry, decision);
    return;
  }
  await wakeSleep(entry, decision);
}

function scheduleSleepCheck(entry: SleepEntry, delayMs?: number) {
  clearSleepTimer(entry);
  const remainingMs = Math.max(0, entry.wakeAt - Date.now());
  const nextDelay =
    typeof delayMs === "number"
      ? delayMs
      : entry.tickIntervalMs
        ? Math.min(entry.tickIntervalMs, remainingMs)
        : remainingMs;
  entry.timer = setTimeout(
    () => {
      void runSleepCheck(entry.sleepId);
    },
    Math.max(1, Math.floor(nextDelay)),
  );
  entry.timer.unref?.();
}

function resolveTickInterval(durationMs: number, heuristics: SleepHeuristics) {
  if (durationMs <= heuristics.shortWaitMs) {
    return undefined;
  }
  if (durationMs >= heuristics.longWaitMs) {
    return heuristics.longTickIntervalMs;
  }
  return heuristics.tickIntervalMs;
}

export function resolveSleepHeuristics(config?: OpenClawConfig): SleepHeuristics {
  const pruningSettings =
    computeEffectiveSettings(config?.agents?.defaults?.contextPruning) ??
    DEFAULT_CONTEXT_PRUNING_SETTINGS;
  const cacheTtlMs = pruningSettings.ttlMs;

  return {
    cacheTtlMs,
    maxSleepMs: clampWithDefault(
      readEnvInt("OPENCLAW_SLEEP_MAX_MS"),
      DEFAULT_SLEEP_MAX_MS,
      1_000,
      7 * 24 * 60 * 60 * 1000,
    ),
    shortWaitMs: clampWithDefault(
      readEnvInt("OPENCLAW_SLEEP_SHORT_WAIT_MS"),
      DEFAULT_SHORT_WAIT_MS,
      1_000,
      10 * 60_000,
    ),
    longWaitMs: clampWithDefault(
      readEnvInt("OPENCLAW_SLEEP_LONG_WAIT_MS"),
      DEFAULT_LONG_WAIT_MS,
      30_000,
      24 * 60 * 60 * 1000,
    ),
    tickIntervalMs: clampWithDefault(
      readEnvInt("OPENCLAW_SLEEP_TICK_MS"),
      Math.max(15_000, Math.min(cacheTtlMs, DEFAULT_MEDIUM_TICK_MS)),
      5_000,
      30 * 60_000,
    ),
    longTickIntervalMs: clampWithDefault(
      readEnvInt("OPENCLAW_SLEEP_LONG_TICK_MS"),
      Math.max(DEFAULT_MEDIUM_TICK_MS, Math.min(cacheTtlMs, DEFAULT_LONG_TICK_MS)),
      15_000,
      60 * 60_000,
    ),
  };
}

export function registerSleep(params: {
  sessionKey: string;
  wakeAt: number;
  reason?: string;
  interruptible?: boolean;
  config?: OpenClawConfig;
}): SleepRegistration {
  const sessionKey = params.sessionKey.trim();
  if (!sessionKey) {
    throw new Error("sleep requires an agent session");
  }
  const heuristics = resolveSleepHeuristics(params.config);
  const scheduledAt = Date.now();
  const requestedWakeAt = Math.max(scheduledAt + 1, Math.floor(params.wakeAt));
  const requestedDurationMs = Math.max(1, requestedWakeAt - scheduledAt);
  const durationMs = Math.min(requestedDurationMs, heuristics.maxSleepMs);
  const wakeAt = scheduledAt + durationMs;
  const tickIntervalMs = resolveTickInterval(durationMs, heuristics);

  removeSleepForSession(sessionKey);

  const entry: SleepEntry = {
    sleepId: crypto.randomUUID(),
    sessionKey,
    scheduledAt,
    requestedWakeAt,
    wakeAt,
    requestedDurationMs,
    durationMs,
    clamped: durationMs !== requestedDurationMs,
    tickIntervalMs,
    heuristics,
    persistence: "memory_only",
    reason: params.reason?.trim() || undefined,
    interruptible: params.interruptible !== false,
    timer: null,
    retries: 0,
  };

  pendingSleeps.set(entry.sleepId, entry);
  scheduleSleepCheck(entry);

  return {
    sleepId: entry.sleepId,
    scheduledAt: entry.scheduledAt,
    requestedWakeAt: entry.requestedWakeAt,
    wakeAt: entry.wakeAt,
    requestedDurationMs: entry.requestedDurationMs,
    durationMs: entry.durationMs,
    clamped: entry.clamped,
    tickIntervalMs: entry.tickIntervalMs,
    heuristics: entry.heuristics,
    persistence: entry.persistence,
  };
}

export function listPendingSleeps() {
  return Array.from(pendingSleeps.values()).map((entry) => ({
    sleepId: entry.sleepId,
    sessionKey: entry.sessionKey,
    scheduledAt: entry.scheduledAt,
    requestedWakeAt: entry.requestedWakeAt,
    wakeAt: entry.wakeAt,
    durationMs: entry.durationMs,
    tickIntervalMs: entry.tickIntervalMs,
    reason: entry.reason,
    interruptible: entry.interruptible,
  }));
}

export function resetSleepRegistryForTests() {
  for (const entry of pendingSleeps.values()) {
    clearSleepTimer(entry);
  }
  pendingSleeps.clear();
}
