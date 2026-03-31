import { describe, expect, it, vi } from "vitest";
import type { GatewayWsClient } from "./server/ws-types.js";
import { createGatewayBroadcaster } from "./server-broadcast.js";

type TestSocket = {
  bufferedAmount: number;
  send: (payload: string) => void;
  close: (code: number, reason: string) => void;
};

describe("gateway broadcaster", () => {
  it("filters approval and pairing events by scope", () => {
    const approvalsSocket: TestSocket = {
      bufferedAmount: 0,
      send: vi.fn(),
      close: vi.fn(),
    };
    const pairingSocket: TestSocket = {
      bufferedAmount: 0,
      send: vi.fn(),
      close: vi.fn(),
    };
    const readSocket: TestSocket = {
      bufferedAmount: 0,
      send: vi.fn(),
      close: vi.fn(),
    };

    const clients = new Set<GatewayWsClient>([
      {
        socket: approvalsSocket as unknown as GatewayWsClient["socket"],
        connect: { role: "operator", scopes: ["operator.approvals"] } as GatewayWsClient["connect"],
        connId: "c-approvals",
      },
      {
        socket: pairingSocket as unknown as GatewayWsClient["socket"],
        connect: { role: "operator", scopes: ["operator.pairing"] } as GatewayWsClient["connect"],
        connId: "c-pairing",
      },
      {
        socket: readSocket as unknown as GatewayWsClient["socket"],
        connect: { role: "operator", scopes: ["operator.read"] } as GatewayWsClient["connect"],
        connId: "c-read",
      },
    ]);

    const { broadcast, broadcastToConnIds } = createGatewayBroadcaster({ clients });

    broadcast("exec.approval.requested", { id: "1" });
    broadcast("device.pair.requested", { requestId: "r1" });

    expect(approvalsSocket.send).toHaveBeenCalledTimes(1);
    expect(pairingSocket.send).toHaveBeenCalledTimes(1);
    expect(readSocket.send).toHaveBeenCalledTimes(0);

    broadcastToConnIds("tick", { ts: 1 }, new Set(["c-read"]));
    expect(readSocket.send).toHaveBeenCalledTimes(1);
    expect(approvalsSocket.send).toHaveBeenCalledTimes(1);
    expect(pairingSocket.send).toHaveBeenCalledTimes(1);
  });

  it("replays buffered events in order and drains live events queued during replay", () => {
    const replaySocket: TestSocket = {
      bufferedAmount: 0,
      send: vi.fn(),
      close: vi.fn(),
    };
    const clients = new Set<GatewayWsClient>();
    const { broadcast, prepareReplayForClient } = createGatewayBroadcaster({ clients });

    broadcast("presence", { status: "before-1" });
    broadcast("health", { status: "before-2" });

    const replayClient: GatewayWsClient = {
      socket: replaySocket as unknown as GatewayWsClient["socket"],
      connect: { role: "operator", scopes: ["operator.admin"] } as GatewayWsClient["connect"],
      connId: "c-replay",
    };
    clients.add(replayClient);

    const replay = prepareReplayForClient(replayClient, 0);
    broadcast("heartbeat", { status: "during-replay" });

    expect(replaySocket.send).toHaveBeenCalledTimes(0);
    expect(replay.status.replayedCount).toBe(2);

    const flushed = replay.flush();

    expect(flushed.queuedCount).toBe(1);
    expect(replaySocket.send).toHaveBeenCalledTimes(3);
    const sentSeqs = (replaySocket.send as ReturnType<typeof vi.fn>).mock.calls.map((call) => {
      const frame = JSON.parse(call[0] as string) as { seq?: number };
      return frame.seq;
    });
    expect(sentSeqs).toEqual([1, 2, 3]);
  });
});
