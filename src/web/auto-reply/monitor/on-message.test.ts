import { beforeEach, describe, expect, it, vi } from "vitest";

const processMessageMock = vi.fn();
const maybeBroadcastMessageMock = vi.fn(async () => false);

vi.mock("../../../config/config.js", () => ({
  loadConfig: vi.fn(() => ({ channels: { whatsapp: {} } })),
}));

vi.mock("../../../routing/resolve-route.js", () => ({
  resolveAgentRoute: vi.fn(() => ({
    agentId: "main",
    sessionKey: "agent:main:whatsapp:dm:+15550001",
    mainSessionKey: "agent:main:main",
    accountId: "default",
  })),
}));

vi.mock("./broadcast.js", () => ({
  maybeBroadcastMessage: (...args: unknown[]) => maybeBroadcastMessageMock(...args),
}));

vi.mock("./group-gating.js", () => ({
  applyGroupGating: vi.fn(() => ({ shouldProcess: true })),
}));

vi.mock("./last-route.js", () => ({
  updateLastRouteInBackground: vi.fn(),
}));

vi.mock("./peer.js", () => ({
  resolvePeerId: vi.fn((msg: { from?: string }) => msg.from ?? ""),
}));

vi.mock("./process-message.js", () => ({
  processMessage: (...args: unknown[]) => processMessageMock(...args),
}));

import { createEchoTracker } from "./echo.js";
import { createWebOnMessageHandler } from "./on-message.js";

describe("createWebOnMessageHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ignores echoed outbound messages by recent outbound message id", async () => {
    const echoTracker = createEchoTracker({ maxItems: 10 });
    echoTracker.rememberMessageIds(["out-123"]);

    const handler = createWebOnMessageHandler({
      cfg: { channels: { whatsapp: {} } } as never,
      verbose: false,
      connectionId: "conn-1",
      maxMediaBytes: 1024,
      groupHistoryLimit: 10,
      groupHistories: new Map(),
      groupMemberNames: new Map(),
      echoTracker,
      backgroundTasks: new Set(),
      replyResolver: vi.fn() as never,
      replyLogger: { warn: vi.fn() } as never,
      baseMentionConfig: { mentionRegexes: [] },
      account: { accountId: "default" },
    });

    await handler({
      id: "out-123",
      from: "+15550001",
      conversationId: "+15550001",
      to: "+15550000",
      accountId: "default",
      body: "echoed reply",
      chatType: "direct",
      chatId: "15550001@s.whatsapp.net",
      sendComposing: vi.fn(),
      reply: vi.fn(),
      sendMedia: vi.fn(),
    });

    expect(processMessageMock).not.toHaveBeenCalled();
    expect(maybeBroadcastMessageMock).not.toHaveBeenCalled();
  });
});
