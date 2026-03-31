import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { emitAgentEvent } from "../infra/agent-events.js";
import {
  connectOk,
  connectReq,
  installGatewayTestHooks,
  onceMessage,
  startServerWithClient,
} from "./test-helpers.js";

installGatewayTestHooks();

describe("gateway replay resume", () => {
  it("replays missed sequenced events after reconnect", async () => {
    const { server, ws, port } = await startServerWithClient();
    let replayWs: WebSocket | null = null;

    try {
      await connectOk(ws);

      const firstRunId = randomUUID();
      const firstEventPromise = onceMessage(
        ws,
        (o) =>
          o.type === "event" &&
          o.event === "agent" &&
          o.payload?.runId === firstRunId &&
          o.payload?.stream === "lifecycle",
      );
      emitAgentEvent({ runId: firstRunId, stream: "lifecycle", data: { msg: "first" } });
      const firstEvent = await firstEventPromise;
      const lastSeq = firstEvent.seq as number;

      ws.close();

      const replayRunId = randomUUID();
      emitAgentEvent({ runId: replayRunId, stream: "lifecycle", data: { msg: "replayed" } });

      replayWs = new WebSocket(`ws://127.0.0.1:${port}`);
      await new Promise<void>((resolve) => replayWs?.once("open", () => resolve()));

      const replayedEventPromise = onceMessage(
        replayWs,
        (o) =>
          o.type === "event" &&
          o.event === "agent" &&
          o.payload?.runId === replayRunId &&
          o.payload?.stream === "lifecycle",
      );
      const connect = await connectReq(replayWs, { lastEventSeq: lastSeq });
      expect(connect.ok).toBe(true);
      const hello = connect.payload as {
        type: "hello-ok";
        resume?: {
          requestedSeq: number;
          replayedCount: number;
          replayedThroughSeq?: number;
        };
      };
      expect(hello.resume?.requestedSeq).toBe(lastSeq);
      expect(hello.resume?.replayedCount).toBeGreaterThanOrEqual(1);

      const replayedEvent = await replayedEventPromise;
      expect(replayedEvent.payload.runId).toBe(replayRunId);
      expect(typeof replayedEvent.seq).toBe("number");
      expect(replayedEvent.seq).toBeGreaterThan(lastSeq);
    } finally {
      replayWs?.close();
      ws.close();
      await server.close();
    }
  });
});
