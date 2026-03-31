import { diagnosticLogger as diag, logLaneDequeue, logLaneEnqueue } from "../logging/diagnostic.js";
import { CommandLane } from "./lanes.js";

// Minimal in-process queue to serialize command executions.
// Default lane ("main") preserves the existing behavior. Additional lanes allow
// low-risk parallelism (e.g. cron jobs) without interleaving stdin / logs for
// the main auto-reply workflow.

type QueueEntry = {
  task: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  enqueuedAt: number;
  warnAfterMs: number;
  onWait?: (waitMs: number, queuedAhead: number) => void;
  priority: CommandQueuePriority;
  sequence: number;
  provenance?: CommandQueueProvenance;
  onInterrupt?: (reason: CommandQueueInterruptedError) => void;
};

type LaneState = {
  lane: string;
  queue: QueueEntry[];
  activeEntries: Set<QueueEntry>;
  maxConcurrent: number;
  draining: boolean;
  nextSequence: number;
};

export type CommandQueuePriority = "now" | "next" | "later";

export type CommandQueueProvenance = {
  source: string;
  agentId?: string;
  sessionId?: string;
  sessionKey?: string;
  originalText?: string;
};

export type CommandQueueInterruptParams = {
  source?: string;
  reason?: string;
  agentId?: string;
  sessionId?: string;
  sessionKey?: string;
};

export type CommandLaneInterruptResult = {
  clearedQueued: number;
  interruptedActive: number;
};

export class CommandQueueInterruptedError extends Error {
  readonly lane: string;
  readonly source?: string;
  readonly reason?: string;
  readonly sessionId?: string;
  readonly sessionKey?: string;
  readonly agentId?: string;

  constructor(lane: string, params: CommandQueueInterruptParams = {}) {
    const summary = params.reason?.trim() || "lane interrupted";
    super(`Command queue interrupted for lane "${lane}": ${summary}`);
    this.name = "CommandQueueInterruptedError";
    this.lane = lane;
    this.source = params.source;
    this.reason = params.reason;
    this.sessionId = params.sessionId;
    this.sessionKey = params.sessionKey;
    this.agentId = params.agentId;
  }
}

const lanes = new Map<string, LaneState>();

function priorityRank(priority: CommandQueuePriority): number {
  switch (priority) {
    case "now":
      return 0;
    case "next":
      return 1;
    case "later":
      return 2;
    default:
      return assertNever(priority);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected queue variant: ${String(value)}`);
}

function insertQueueEntry(state: LaneState, entry: QueueEntry) {
  const rank = priorityRank(entry.priority);
  let idx = state.queue.findIndex((candidate) => {
    const candidateRank = priorityRank(candidate.priority);
    if (candidateRank !== rank) {
      return candidateRank > rank;
    }
    return candidate.sequence > entry.sequence;
  });
  if (idx < 0) {
    idx = state.queue.length;
  }
  state.queue.splice(idx, 0, entry);
}

function clearQueuedEntries(state: LaneState, reason: CommandQueueInterruptedError): number {
  const removed = state.queue.splice(0, state.queue.length);
  for (const entry of removed) {
    entry.reject(reason);
  }
  return removed.length;
}

function getLaneState(lane: string): LaneState {
  const existing = lanes.get(lane);
  if (existing) {
    return existing;
  }
  const created: LaneState = {
    lane,
    queue: [],
    activeEntries: new Set(),
    maxConcurrent: 1,
    draining: false,
    nextSequence: 0,
  };
  lanes.set(lane, created);
  return created;
}

function drainLane(lane: string) {
  const state = getLaneState(lane);
  if (state.draining) {
    return;
  }
  state.draining = true;

  const pump = () => {
    while (state.activeEntries.size < state.maxConcurrent && state.queue.length > 0) {
      const entry = state.queue.shift() as QueueEntry;
      const waitedMs = Date.now() - entry.enqueuedAt;
      if (waitedMs >= entry.warnAfterMs) {
        entry.onWait?.(waitedMs, state.queue.length);
        diag.warn(
          `lane wait exceeded: lane=${lane} waitedMs=${waitedMs} queueAhead=${state.queue.length}`,
        );
      }
      logLaneDequeue(lane, waitedMs, state.queue.length);
      state.activeEntries.add(entry);
      void (async () => {
        const startTime = Date.now();
        try {
          const result = await entry.task();
          state.activeEntries.delete(entry);
          diag.debug(
            `lane task done: lane=${lane} durationMs=${Date.now() - startTime} active=${state.activeEntries.size} queued=${state.queue.length}`,
          );
          pump();
          entry.resolve(result);
        } catch (err) {
          state.activeEntries.delete(entry);
          const isProbeLane = lane.startsWith("auth-probe:") || lane.startsWith("session:probe-");
          if (!isProbeLane) {
            diag.error(
              `lane task error: lane=${lane} durationMs=${Date.now() - startTime} error="${String(err)}"`,
            );
          }
          pump();
          entry.reject(err);
        }
      })();
    }
    state.draining = false;
  };

  pump();
}

export function setCommandLaneConcurrency(lane: string, maxConcurrent: number) {
  const cleaned = lane.trim() || CommandLane.Main;
  const state = getLaneState(cleaned);
  state.maxConcurrent = Math.max(1, Math.floor(maxConcurrent));
  drainLane(cleaned);
}

export function enqueueCommandInLane<T>(
  lane: string,
  task: () => Promise<T>,
  opts?: {
    warnAfterMs?: number;
    onWait?: (waitMs: number, queuedAhead: number) => void;
    priority?: CommandQueuePriority;
    provenance?: CommandQueueProvenance;
    onInterrupt?: (reason: CommandQueueInterruptedError) => void;
  },
): Promise<T> {
  const cleaned = lane.trim() || CommandLane.Main;
  const warnAfterMs = opts?.warnAfterMs ?? 2_000;
  const state = getLaneState(cleaned);
  return new Promise<T>((resolve, reject) => {
    const entry: QueueEntry = {
      task: () => task(),
      resolve: (value) => resolve(value as T),
      reject,
      enqueuedAt: Date.now(),
      warnAfterMs,
      onWait: opts?.onWait,
      priority: opts?.priority ?? "next",
      sequence: state.nextSequence++,
      provenance: opts?.provenance,
      onInterrupt: opts?.onInterrupt,
    };
    insertQueueEntry(state, entry);
    if (entry.provenance?.source) {
      diag.debug(
        `lane enqueue meta: lane=${cleaned} priority=${entry.priority} source=${entry.provenance.source}`,
      );
    }
    logLaneEnqueue(cleaned, state.queue.length + state.activeEntries.size);
    drainLane(cleaned);
  });
}

export function enqueueCommand<T>(
  task: () => Promise<T>,
  opts?: {
    warnAfterMs?: number;
    onWait?: (waitMs: number, queuedAhead: number) => void;
    priority?: CommandQueuePriority;
    provenance?: CommandQueueProvenance;
    onInterrupt?: (reason: CommandQueueInterruptedError) => void;
  },
): Promise<T> {
  return enqueueCommandInLane(CommandLane.Main, task, opts);
}

export function getQueueSize(lane: string = CommandLane.Main) {
  const resolved = lane.trim() || CommandLane.Main;
  const state = lanes.get(resolved);
  if (!state) {
    return 0;
  }
  return state.queue.length + state.activeEntries.size;
}

export function getTotalQueueSize() {
  let total = 0;
  for (const s of lanes.values()) {
    total += s.queue.length + s.activeEntries.size;
  }
  return total;
}

export function clearCommandLane(
  lane: string = CommandLane.Main,
  params: CommandQueueInterruptParams = {},
) {
  const cleaned = lane.trim() || CommandLane.Main;
  const state = lanes.get(cleaned);
  if (!state) {
    return 0;
  }
  const reason = new CommandQueueInterruptedError(cleaned, {
    source: params.source ?? "lane.clear",
    reason: params.reason ?? "queued work cleared",
    agentId: params.agentId,
    sessionId: params.sessionId,
    sessionKey: params.sessionKey,
  });
  return clearQueuedEntries(state, reason);
}

export function requestCommandLaneInterrupt(
  lane: string = CommandLane.Main,
  params: CommandQueueInterruptParams = {},
): CommandLaneInterruptResult {
  const cleaned = lane.trim() || CommandLane.Main;
  const state = lanes.get(cleaned);
  if (!state) {
    return { clearedQueued: 0, interruptedActive: 0 };
  }

  const reason = new CommandQueueInterruptedError(cleaned, {
    source: params.source ?? "lane.interrupt",
    reason: params.reason ?? "interrupt requested",
    agentId: params.agentId,
    sessionId: params.sessionId,
    sessionKey: params.sessionKey,
  });
  const clearedQueued = clearQueuedEntries(state, reason);
  let interruptedActive = 0;
  for (const entry of state.activeEntries) {
    if (!entry.onInterrupt) {
      continue;
    }
    interruptedActive += 1;
    try {
      entry.onInterrupt(reason);
    } catch (err) {
      diag.error(`lane interrupt failed: lane=${cleaned} error="${String(err)}"`);
    }
  }
  if (clearedQueued > 0 || interruptedActive > 0) {
    diag.warn(
      `lane interrupted: lane=${cleaned} active=${interruptedActive} cleared=${clearedQueued} source=${params.source ?? "lane.interrupt"}`,
    );
  }
  return { clearedQueued, interruptedActive };
}
