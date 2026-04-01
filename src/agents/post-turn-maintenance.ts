import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { OpenClawConfig } from "../config/config.js";
import type { EmbeddedRunPurpose } from "./pi-embedded-runner/run/params.js";
import type { EmbeddedPiRunMeta } from "./pi-embedded-runner/types.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { isSubagentSessionKey } from "../routing/session-key.js";

const log = createSubsystemLogger("agents/post-turn-maintenance");

export type PostTurnMaintenanceContext = {
  sessionId: string;
  sessionKey: string;
  sessionFile: string;
  workspaceDir: string;
  agentId?: string;
  agentDir?: string;
  config?: OpenClawConfig;
  taskId?: string;
  provider: string;
  model: string;
  authProfileId?: string;
  messagesSnapshot: AgentMessage[];
};

export type PostTurnMaintenanceJob = {
  name: string;
  run: (context: PostTurnMaintenanceContext) => Promise<void>;
};

type QueueState = {
  running: boolean;
  pending?: PostTurnMaintenanceContext;
  currentRun?: Promise<void>;
};

type DrainWaiter = {
  queueKey?: string;
  resolve: (value: boolean) => void;
};

export function shouldSchedulePostTurnMaintenance(params: {
  runPurpose?: EmbeddedRunPurpose;
  sessionKey?: string;
  resultMeta: EmbeddedPiRunMeta;
}): boolean {
  if ((params.runPurpose ?? "primary_user") !== "primary_user") {
    return false;
  }
  const sessionKey = params.sessionKey?.trim();
  if (!sessionKey || isSubagentSessionKey(sessionKey)) {
    return false;
  }
  if (params.resultMeta.aborted || params.resultMeta.error) {
    return false;
  }
  if (params.resultMeta.stopReason === "tool_calls") {
    return false;
  }
  if ((params.resultMeta.pendingToolCalls?.length ?? 0) > 0) {
    return false;
  }
  return true;
}

export type PostTurnMaintenanceManager = {
  schedule: (context: PostTurnMaintenanceContext) => void;
  drainPendingMaintenance: (timeoutMs: number, queueKey?: string) => Promise<boolean>;
};

export function createPostTurnMaintenanceManager(
  jobs: PostTurnMaintenanceJob[],
): PostTurnMaintenanceManager {
  const queueStates = new Map<string, QueueState>();
  const drainWaiters = new Set<DrainWaiter>();

  const isQueueIdle = (queueKey: string) => {
    const state = queueStates.get(queueKey);
    return !state || (!state.running && !state.pending && !state.currentRun);
  };

  const areAllQueuesIdle = () => {
    for (const queueKey of queueStates.keys()) {
      if (!isQueueIdle(queueKey)) {
        return false;
      }
    }
    return true;
  };

  const flushDrainWaiters = () => {
    for (const waiter of [...drainWaiters]) {
      const idle = waiter.queueKey ? isQueueIdle(waiter.queueKey) : areAllQueuesIdle();
      if (!idle) {
        continue;
      }
      drainWaiters.delete(waiter);
      waiter.resolve(true);
    }
  };

  const settleQueue = (queueKey: string) => {
    const state = queueStates.get(queueKey);
    if (!state) {
      flushDrainWaiters();
      return;
    }
    if (state.running || state.pending || state.currentRun) {
      return;
    }
    queueStates.delete(queueKey);
    flushDrainWaiters();
  };

  const runQueue = async (queueKey: string) => {
    const state = queueStates.get(queueKey);
    if (!state || state.running) {
      return;
    }

    while (state.pending) {
      const context = state.pending;
      state.pending = undefined;
      state.running = true;

      const runPromise = (async () => {
        for (const job of jobs) {
          try {
            await job.run(context);
          } catch (err) {
            log.warn(
              `maintenance job failed: queue=${queueKey} job=${job.name} error=${String(err)}`,
            );
          }
        }
      })();
      state.currentRun = runPromise;

      try {
        await runPromise;
      } finally {
        state.currentRun = undefined;
        state.running = false;
      }
    }

    settleQueue(queueKey);
  };

  return {
    schedule: (context) => {
      const queueKey = context.sessionKey;
      const state = queueStates.get(queueKey) ?? { running: false };
      state.pending = context;
      queueStates.set(queueKey, state);
      if (!state.running) {
        void runQueue(queueKey);
      }
    },
    drainPendingMaintenance: async (timeoutMs, queueKey) => {
      const key = queueKey?.trim();
      const idleNow = key ? isQueueIdle(key) : areAllQueuesIdle();
      if (idleNow) {
        return true;
      }
      return await new Promise<boolean>((resolve) => {
        let settled = false;
        let waiter: DrainWaiter | undefined;
        const finish = (value: boolean) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timer);
          if (waiter) {
            drainWaiters.delete(waiter);
          }
          resolve(value);
        };
        const timer = setTimeout(() => finish(false), Math.max(1, timeoutMs));
        waiter = {
          queueKey: key,
          resolve: finish,
        };
        drainWaiters.add(waiter);
      });
    },
  };
}
