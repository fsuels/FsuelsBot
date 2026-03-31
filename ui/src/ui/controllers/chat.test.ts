import { describe, expect, it, vi } from "vitest";
import { createChatLifecycleGuard } from "./chat-lifecycle-guard.ts";
import {
  handleChatEvent,
  loadChatHistory,
  sendChatMessage,
  type ChatEventPayload,
  type ChatState,
} from "./chat.ts";

function createState(overrides: Partial<ChatState> = {}): ChatState {
  const chatLifecycleGuard = createChatLifecycleGuard();
  const state: ChatState = {
    chatAttachments: [],
    chatLifecycleGuard,
    chatLoading: false,
    chatMessage: "",
    chatMessages: [],
    chatRunId: null,
    chatSending: false,
    chatStream: null,
    chatStreamStartedAt: null,
    chatThinkingLevel: null,
    client: null,
    connected: true,
    lastError: null,
    sessionKey: "main",
    ...overrides,
  };
  chatLifecycleGuard.subscribe((snapshot) => {
    state.chatSending = snapshot.phase === "reserved";
    state.chatRunId = snapshot.runId;
  });
  const initialRunId = typeof overrides.chatRunId === "string" ? overrides.chatRunId.trim() : "";
  if (initialRunId) {
    chatLifecycleGuard.reserve();
    chatLifecycleGuard.tryStart(initialRunId);
  } else if (overrides.chatSending) {
    chatLifecycleGuard.reserve();
  }
  return state;
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return {
    promise,
    resolve,
    reject,
  };
}

describe("handleChatEvent", () => {
  it("returns null when payload is missing", () => {
    const state = createState();
    expect(handleChatEvent(state, undefined)).toBe(null);
  });

  it("returns null when sessionKey does not match", () => {
    const state = createState({ sessionKey: "main" });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "other",
      state: "final",
    };
    expect(handleChatEvent(state, payload)).toBe(null);
  });

  it("returns null for delta from another run", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-user",
      chatStream: "Hello",
    });
    const payload: ChatEventPayload = {
      runId: "run-announce",
      sessionKey: "main",
      state: "delta",
      message: { role: "assistant", content: [{ type: "text", text: "Done" }] },
    };
    expect(handleChatEvent(state, payload)).toBe(null);
    expect(state.chatRunId).toBe("run-user");
    expect(state.chatStream).toBe("Hello");
  });

  it("returns 'final' for final from another run (e.g. sub-agent announce) without clearing state", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-user",
      chatStream: "Working...",
      chatStreamStartedAt: 123,
    });
    const payload: ChatEventPayload = {
      runId: "run-announce",
      sessionKey: "main",
      state: "final",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Sub-agent findings" }],
      },
    };
    expect(handleChatEvent(state, payload)).toBe("final");
    expect(state.chatRunId).toBe("run-user");
    expect(state.chatStream).toBe("Working...");
    expect(state.chatStreamStartedAt).toBe(123);
  });

  it("processes final from own run and clears state", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "Reply",
      chatStreamStartedAt: 100,
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "final",
    };
    expect(handleChatEvent(state, payload)).toBe("final");
    expect(state.chatRunId).toBe(null);
    expect(state.chatStream).toBe(null);
    expect(state.chatStreamStartedAt).toBe(null);
  });
});

describe("sendChatMessage", () => {
  it("does not let a stale request failure clear a newer run", async () => {
    const first = createDeferred<unknown>();
    const client = {
      request: vi
        .fn()
        .mockImplementationOnce(() => first.promise)
        .mockResolvedValueOnce(undefined),
    } as unknown as NonNullable<ChatState["client"]>;
    const state = createState({ client });

    const firstSend = sendChatMessage(state, "first");
    const firstRunId = state.chatRunId;
    expect(firstRunId).toBeTruthy();
    expect(state.chatLifecycleGuard?.getSnapshot().runId).toBe(firstRunId);

    state.chatLifecycleGuard?.forceEnd();
    state.chatStream = null;
    state.chatStreamStartedAt = null;

    const secondSend = sendChatMessage(state, "second");
    const secondRunId = state.chatRunId;
    expect(secondRunId).toBeTruthy();
    expect(secondRunId).not.toBe(firstRunId);

    first.reject(new Error("stale failure"));

    await expect(firstSend).resolves.toBeNull();
    await expect(secondSend).resolves.toBe(secondRunId);

    expect(state.chatRunId).toBe(secondRunId);
    expect(state.chatLifecycleGuard?.getSnapshot().runId).toBe(secondRunId);
    expect(state.chatStream).toBe("");
    expect(state.lastError).toBeNull();
  });
});

describe("loadChatHistory", () => {
  it("ignores stale history responses after the session changes", async () => {
    const first = createDeferred<{ messages: Array<unknown>; thinkingLevel: string }>();
    const second = createDeferred<{ messages: Array<unknown>; thinkingLevel: string }>();
    const client = {
      request: vi.fn((method: string, params: unknown) => {
        const payload = params as { sessionKey?: string };
        if (method === "chat.history" && payload.sessionKey === "session-a") {
          return first.promise;
        }
        if (method === "chat.history" && payload.sessionKey === "session-b") {
          return second.promise;
        }
        return Promise.resolve({ messages: [], thinkingLevel: "low" });
      }),
    } as unknown as NonNullable<ChatState["client"]>;
    const state = createState({ client, sessionKey: "session-a" });

    const sessionA = loadChatHistory(state);
    state.sessionKey = "session-b";
    const sessionB = loadChatHistory(state);

    second.resolve({
      messages: [{ role: "assistant", content: [{ type: "text", text: "B" }] }],
      thinkingLevel: "high",
    });
    await sessionB;

    expect(state.chatMessages).toEqual([
      { role: "assistant", content: [{ type: "text", text: "B" }] },
    ]);
    expect(state.chatThinkingLevel).toBe("high");

    first.resolve({
      messages: [{ role: "assistant", content: [{ type: "text", text: "A" }] }],
      thinkingLevel: "low",
    });
    await sessionA;

    expect(state.chatMessages).toEqual([
      { role: "assistant", content: [{ type: "text", text: "B" }] },
    ]);
    expect(state.chatThinkingLevel).toBe("high");
    expect(state.chatLoading).toBe(false);
  });
});
