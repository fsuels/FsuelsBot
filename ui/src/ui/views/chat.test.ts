import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import type { AgentReaction } from "../app-tool-stream.ts";
import type { SessionsListResult } from "../types.ts";
import { renderChat, type ChatProps } from "./chat.ts";

function createSessions(): SessionsListResult {
  return {
    ts: 0,
    path: "",
    count: 0,
    defaults: { model: null, contextTokens: null },
    sessions: [],
  };
}

function createProps(overrides: Partial<ChatProps> = {}): ChatProps {
  return {
    sessionKey: "main",
    onSessionKeyChange: () => undefined,
    thinkingLevel: null,
    showThinking: false,
    loading: false,
    sending: false,
    canAbort: false,
    chatReaction: null,
    messages: [],
    toolMessages: [],
    stream: null,
    streamStartedAt: null,
    assistantAvatarUrl: null,
    draft: "",
    queue: [],
    connected: true,
    canSend: true,
    disabledReason: null,
    error: null,
    sessions: createSessions(),
    focusMode: false,
    assistantName: "OpenClaw",
    assistantAvatar: null,
    onRefresh: () => undefined,
    onToggleFocusMode: () => undefined,
    onDraftChange: () => undefined,
    onSend: () => undefined,
    onQueueRemove: () => undefined,
    onNewSession: () => undefined,
    ...overrides,
  };
}

function createReaction(overrides: Partial<AgentReaction> = {}): AgentReaction {
  return {
    text: "Compacting context...",
    createdAt: 1_000,
    ttlMs: 5_000,
    channel: "system",
    style: "idle",
    ...overrides,
  };
}

describe("chat view", () => {
  it("renders active reactions in the dedicated lane", () => {
    const container = document.createElement("div");
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_500);
    render(
      renderChat(
        createProps({
          chatReaction: createReaction(),
        }),
      ),
      container,
    );

    const indicator = container.querySelector(".chat-reaction--idle");
    expect(indicator).not.toBeNull();
    expect(indicator?.textContent).toContain("Compacting context...");
    nowSpy.mockRestore();
  });

  it("renders fading reactions near expiry", () => {
    const container = document.createElement("div");
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(5_400);
    render(
      renderChat(
        createProps({
          chatReaction: createReaction({
            text: "Context compacted",
            createdAt: 1_000,
            ttlMs: 5_000,
            style: "success",
          }),
        }),
      ),
      container,
    );

    const indicator = container.querySelector(".chat-reaction--success.chat-reaction--fading");
    expect(indicator).not.toBeNull();
    expect(indicator?.textContent).toContain("Context compacted");
    nowSpy.mockRestore();
  });

  it("hides stale reactions after expiry", () => {
    const container = document.createElement("div");
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(10_000);
    render(
      renderChat(
        createProps({
          chatReaction: createReaction({
            text: "Tool failed",
            createdAt: 0,
            ttlMs: 2_000,
            style: "error",
            channel: "tool",
          }),
        }),
      ),
      container,
    );

    expect(container.querySelector(".chat-reaction")).toBeNull();
    expect(container.querySelector(".chat-reaction-lane")).not.toBeNull();
    nowSpy.mockRestore();
  });

  it("shows a stop button when aborting is available", () => {
    const container = document.createElement("div");
    const onAbort = vi.fn();
    render(
      renderChat(
        createProps({
          canAbort: true,
          onAbort,
        }),
      ),
      container,
    );

    const stopButton = Array.from(container.querySelectorAll("button")).find(
      (btn) => btn.textContent?.trim() === "Stop",
    );
    expect(stopButton).not.toBeUndefined();
    stopButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain("New session");
  });

  it("shows a new session button when aborting is unavailable", () => {
    const container = document.createElement("div");
    const onNewSession = vi.fn();
    render(
      renderChat(
        createProps({
          canAbort: false,
          onNewSession,
        }),
      ),
      container,
    );

    const newSessionButton = Array.from(container.querySelectorAll("button")).find(
      (btn) => btn.textContent?.trim() === "New session",
    );
    expect(newSessionButton).not.toBeUndefined();
    newSessionButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onNewSession).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain("Stop");
  });
});
