import type { GatewayWsClient } from "./server/ws-types.js";
import { EVENT_REPLAY_BUFFER_MAX, MAX_BUFFERED_BYTES } from "./server-constants.js";
import { logWs, summarizeAgentEventForWsLog } from "./ws-log.js";

const ADMIN_SCOPE = "operator.admin";
const APPROVALS_SCOPE = "operator.approvals";
const PAIRING_SCOPE = "operator.pairing";

const EVENT_SCOPE_GUARDS: Record<string, string[]> = {
  "exec.approval.requested": [APPROVALS_SCOPE],
  "exec.approval.resolved": [APPROVALS_SCOPE],
  "device.pair.requested": [PAIRING_SCOPE],
  "device.pair.resolved": [PAIRING_SCOPE],
  "node.pair.requested": [PAIRING_SCOPE],
  "node.pair.resolved": [PAIRING_SCOPE],
};

type BroadcastOptions = {
  dropIfSlow?: boolean;
  stateVersion?: { presence?: number; health?: number };
};

type PreparedEventFrame = {
  frame: string;
  event: string;
  seq?: number;
  dropIfSlow?: boolean;
};

type ReplayBufferEntry = PreparedEventFrame & {
  seq: number;
};

export type GatewayReplayStatus = {
  requestedSeq: number;
  replayedCount: number;
  replayedThroughSeq?: number;
  bufferedFromSeq?: number;
  latestSeq: number;
  gap: boolean;
  reset: boolean;
};

function hasEventScope(client: GatewayWsClient, event: string): boolean {
  const required = EVENT_SCOPE_GUARDS[event];
  if (!required) {
    return true;
  }
  const role = client.connect.role ?? "operator";
  if (role !== "operator") {
    return false;
  }
  const scopes = Array.isArray(client.connect.scopes) ? client.connect.scopes : [];
  if (scopes.includes(ADMIN_SCOPE)) {
    return true;
  }
  return required.some((scope) => scopes.includes(scope));
}

function isReplayableEvent(event: string, targetConnIds?: ReadonlySet<string>): boolean {
  return !targetConnIds && event !== "tick";
}

export function createGatewayBroadcaster(params: { clients: Set<GatewayWsClient> }) {
  let seq = 0;
  const replayBuffer: ReplayBufferEntry[] = [];

  const sendPreparedFrame = (
    client: GatewayWsClient,
    prepared: PreparedEventFrame,
    opts?: { bypassReplayQueue?: boolean },
  ) => {
    if (!hasEventScope(client, prepared.event)) {
      return;
    }
    if (client.replayState?.active && !opts?.bypassReplayQueue) {
      client.replayState.queuedFrames.push({
        event: prepared.event,
        frame: prepared.frame,
        dropIfSlow: prepared.dropIfSlow,
      });
      return;
    }
    const slow = client.socket.bufferedAmount > MAX_BUFFERED_BYTES;
    if (slow && prepared.dropIfSlow) {
      return;
    }
    if (slow) {
      try {
        client.socket.close(1008, "slow consumer");
      } catch {
        /* ignore */
      }
      return;
    }
    try {
      client.socket.send(prepared.frame);
    } catch {
      /* ignore */
    }
  };

  const flushReplayQueue = (client: GatewayWsClient) => {
    const queued = client.replayState?.queuedFrames ?? [];
    client.replayState = undefined;
    for (const prepared of queued) {
      sendPreparedFrame(
        client,
        {
          event: prepared.event,
          frame: prepared.frame,
          dropIfSlow: prepared.dropIfSlow,
        },
        { bypassReplayQueue: true },
      );
    }
    return queued.length;
  };

  const broadcastInternal = (
    event: string,
    payload: unknown,
    opts?: BroadcastOptions,
    targetConnIds?: ReadonlySet<string>,
  ) => {
    const isTargeted = Boolean(targetConnIds);
    const eventSeq = isReplayableEvent(event, targetConnIds) ? ++seq : undefined;
    const prepared: PreparedEventFrame = {
      event,
      seq: eventSeq,
      dropIfSlow: opts?.dropIfSlow,
      frame: JSON.stringify({
        type: "event",
        event,
        payload,
        seq: eventSeq,
        stateVersion: opts?.stateVersion,
      }),
    };
    if (eventSeq !== undefined) {
      replayBuffer.push({
        ...prepared,
        seq: eventSeq,
      });
      while (replayBuffer.length > EVENT_REPLAY_BUFFER_MAX) {
        replayBuffer.shift();
      }
    }
    const logMeta: Record<string, unknown> = {
      event,
      seq: eventSeq ?? (isTargeted ? "targeted" : "unsequenced"),
      clients: params.clients.size,
      targets: targetConnIds ? targetConnIds.size : undefined,
      dropIfSlow: opts?.dropIfSlow,
      presenceVersion: opts?.stateVersion?.presence,
      healthVersion: opts?.stateVersion?.health,
    };
    if (event === "agent") {
      Object.assign(logMeta, summarizeAgentEventForWsLog(payload));
    }
    logWs("out", "event", logMeta);
    for (const client of params.clients) {
      if (targetConnIds && !targetConnIds.has(client.connId)) {
        continue;
      }
      sendPreparedFrame(client, prepared);
    }
  };

  const prepareReplayForClient = (client: GatewayWsClient, requestedSeq: number) => {
    client.replayState = {
      active: true,
      queuedFrames: [],
    };
    const latestSeq = seq;
    const bufferedFromSeq = replayBuffer[0]?.seq;
    const reset = requestedSeq > latestSeq;
    const gap =
      !reset &&
      requestedSeq < latestSeq &&
      (bufferedFromSeq === undefined || requestedSeq < bufferedFromSeq - 1);
    const entries = reset ? [] : replayBuffer.filter((entry) => entry.seq > requestedSeq);
    const status: GatewayReplayStatus = {
      requestedSeq,
      replayedCount: entries.length,
      replayedThroughSeq: entries.at(-1)?.seq,
      bufferedFromSeq,
      latestSeq,
      gap,
      reset,
    };

    const flush = () => {
      for (const entry of entries) {
        sendPreparedFrame(client, entry, { bypassReplayQueue: true });
      }
      const queuedCount = flushReplayQueue(client);
      return { queuedCount };
    };

    return { status, flush };
  };

  const broadcast = (event: string, payload: unknown, opts?: BroadcastOptions) =>
    broadcastInternal(event, payload, opts);

  const broadcastToConnIds = (
    event: string,
    payload: unknown,
    connIds: ReadonlySet<string>,
    opts?: BroadcastOptions,
  ) => {
    if (connIds.size === 0) {
      return;
    }
    broadcastInternal(event, payload, opts, connIds);
  };

  return { broadcast, broadcastToConnIds, prepareReplayForClient };
}
