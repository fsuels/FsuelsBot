import { describe, expect, it, vi } from "vitest";
import { flushChatQueueForEvent, handleAbortChat, handleSendChat } from "./app-chat.ts";
import { createChatLifecycleGuard } from "./controllers/chat-lifecycle-guard.ts";
import { handleChatEvent } from "./controllers/chat.ts";

function createHost() {
  const chatLifecycleGuard = createChatLifecycleGuard();
  const client = {
    request: vi.fn(async () => undefined),
  };
  const host = {
    client,
    connected: true,
    sessionKey: "main",
    chatMessage: "",
    chatAttachments: [],
    chatQueue: [],
    chatRunId: null,
    chatSending: false,
    chatLoading: false,
    chatMessages: [],
    chatThinkingLevel: null,
    chatStream: null,
    chatStreamStartedAt: null,
    lastError: null,
    chatLifecycleGuard,
    basePath: "",
    hello: null,
    chatAvatarUrl: null,
    refreshSessionsAfterChat: new Set<string>(),
    settings: {
      gatewayUrl: "ws://localhost",
      token: "",
      sessionKey: "main",
      lastActiveSessionKey: "main",
      theme: "system" as const,
      chatFocusMode: false,
      chatShowThinking: true,
      splitRatio: 0.6,
      navCollapsed: false,
      navGroupsCollapsed: {},
    },
    applySessionKey: "main",
    theme: "system" as const,
    themeResolved: "dark" as const,
    updateComplete: Promise.resolve(),
    querySelector: () => null,
    style: document.documentElement.style,
    chatScrollFrame: null,
    chatScrollTimeout: null,
    chatHasAutoScrolled: false,
    chatUserNearBottom: true,
    chatNewMessagesBelow: false,
    logsScrollFrame: null,
    logsAtBottom: true,
    topbarObserver: null,
    toolStreamById: new Map(),
    toolStreamOrder: [],
    chatToolMessages: [],
    toolStreamSyncTimer: null,
    chatReaction: null,
    chatReactionClearTimer: null,
  };
  chatLifecycleGuard.subscribe((snapshot) => {
    host.chatSending = snapshot.phase === "reserved";
    host.chatRunId = snapshot.runId;
  });
  return host;
}

describe("app chat lifecycle", () => {
  it("queues a second submit while the first run is active, then flushes it after completion", async () => {
    const host = createHost();

    host.chatMessage = "first";
    await handleSendChat(host);
    const firstRunId = host.chatRunId;

    host.chatMessage = "second";
    await handleSendChat(host);

    expect(firstRunId).toBeTruthy();
    expect(host.chatQueue).toHaveLength(1);
    expect(host.chatQueue[0]?.text).toBe("second");
    expect(host.client.request).toHaveBeenCalledTimes(1);
    expect(host.client.request).toHaveBeenNthCalledWith(
      1,
      "chat.send",
      expect.objectContaining({ message: "first", sessionKey: "main" }),
    );

    handleChatEvent(host, {
      runId: firstRunId!,
      sessionKey: "main",
      state: "final",
    });
    await flushChatQueueForEvent(host);

    expect(host.chatQueue).toHaveLength(0);
    expect(host.client.request).toHaveBeenCalledTimes(2);
    expect(host.client.request).toHaveBeenNthCalledWith(
      2,
      "chat.send",
      expect.objectContaining({ message: "second", sessionKey: "main" }),
    );
    expect(host.chatRunId).not.toBe(firstRunId);
  });

  it("keeps an immediate resubmit queued until the abort event lands", async () => {
    const host = createHost();

    host.chatMessage = "first";
    await handleSendChat(host);
    const firstRunId = host.chatRunId;

    await handleAbortChat(host);
    expect(host.client.request).toHaveBeenNthCalledWith(
      2,
      "chat.abort",
      expect.objectContaining({ runId: firstRunId, sessionKey: "main" }),
    );

    host.chatMessage = "follow up";
    await handleSendChat(host);

    expect(host.chatQueue).toHaveLength(1);
    expect(host.chatQueue[0]?.text).toBe("follow up");

    handleChatEvent(host, {
      runId: firstRunId!,
      sessionKey: "main",
      state: "aborted",
    });
    await flushChatQueueForEvent(host);

    expect(host.chatQueue).toHaveLength(0);
    expect(host.client.request).toHaveBeenCalledTimes(3);
    expect(host.client.request).toHaveBeenNthCalledWith(
      3,
      "chat.send",
      expect.objectContaining({ message: "follow up", sessionKey: "main" }),
    );
  });
});
