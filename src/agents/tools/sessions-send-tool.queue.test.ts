import { beforeEach, describe, expect, it, vi } from "vitest";

const callGatewayMock = vi.fn();
const loadSessionEntryMock = vi.fn();
const isEmbeddedPiRunActiveMock = vi.fn();
const queueEmbeddedPiMessageMock = vi.fn();
const waitForEmbeddedPiRunEndMock = vi.fn();
const runSessionsSendA2AFlowMock = vi.fn();

vi.mock("../../gateway/call.js", () => ({
  callGateway: (opts: unknown) => callGatewayMock(opts),
}));

vi.mock("../../gateway/session-utils.js", () => ({
  loadSessionEntry: (sessionKey: string) => loadSessionEntryMock(sessionKey),
}));

vi.mock("../pi-embedded.js", () => ({
  isEmbeddedPiRunActive: (sessionId: string) => isEmbeddedPiRunActiveMock(sessionId),
  queueEmbeddedPiMessage: (sessionId: string, text: string) =>
    queueEmbeddedPiMessageMock(sessionId, text),
  waitForEmbeddedPiRunEnd: (sessionId: string, timeoutMs?: number) =>
    waitForEmbeddedPiRunEndMock(sessionId, timeoutMs),
}));

vi.mock("./sessions-send-tool.a2a.js", () => ({
  runSessionsSendA2AFlow: (params: unknown) => runSessionsSendA2AFlowMock(params),
}));

vi.mock("../../config/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../config/config.js")>();
  return {
    ...actual,
    loadConfig: () =>
      ({
        session: {
          mainKey: "main",
          scope: "per-sender",
          agentToAgent: { maxPingPongTurns: 0 },
        },
      }) as never,
  };
});

import { createSessionsSendTool } from "./sessions-send-tool.js";

describe("sessions_send active-run queueing", () => {
  beforeEach(() => {
    callGatewayMock.mockReset();
    loadSessionEntryMock.mockReset();
    isEmbeddedPiRunActiveMock.mockReset();
    queueEmbeddedPiMessageMock.mockReset();
    waitForEmbeddedPiRunEndMock.mockReset();
    runSessionsSendA2AFlowMock.mockReset();
  });

  it("queues into an active target session instead of starting a duplicate run", async () => {
    const historyReplies = ["old reply", "new reply"];
    callGatewayMock.mockImplementation(async (opts: unknown) => {
      const request = opts as { method?: string };
      if (request.method === "chat.history") {
        return {
          messages: [
            {
              role: "assistant",
              content: [{ type: "text", text: historyReplies.shift() ?? "" }],
            },
          ],
        };
      }
      throw new Error(`unexpected gateway call: ${String(request.method)}`);
    });
    loadSessionEntryMock.mockReturnValue({
      canonicalKey: "agent:main:worker",
      entry: { sessionId: "session-123" },
    });
    isEmbeddedPiRunActiveMock.mockReturnValue(true);
    queueEmbeddedPiMessageMock.mockReturnValue(true);
    waitForEmbeddedPiRunEndMock.mockResolvedValue(true);

    const tool = createSessionsSendTool({
      agentSessionKey: "agent:main:main",
      agentChannel: "discord",
    });

    const result = await tool.execute("call-queue", {
      sessionKey: "agent:main:worker",
      message: "Follow up on the failing test only.",
      timeoutSeconds: 1,
    });

    expect(result.details).toMatchObject({
      status: "ok",
      reply: "new reply",
      sessionKey: "agent:main:worker",
      delivery: { status: "queued", mode: "active-run" },
    });
    expect(isEmbeddedPiRunActiveMock).toHaveBeenCalledWith("session-123");
    expect(queueEmbeddedPiMessageMock).toHaveBeenCalledWith(
      "session-123",
      "Follow up on the failing test only.",
    );
    expect(waitForEmbeddedPiRunEndMock).toHaveBeenCalledWith("session-123", 1000);
    const methods = callGatewayMock.mock.calls.map(
      ([arg]) => (arg as { method?: string }).method,
    );
    expect(methods).toEqual(["chat.history", "chat.history"]);
    expect(runSessionsSendA2AFlowMock).toHaveBeenCalledWith(
      expect.objectContaining({
        targetSessionKey: "agent:main:worker",
        displayKey: "agent:main:worker",
        roundOneReply: "new reply",
      }),
    );
  });
});
