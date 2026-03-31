import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { SessionManager } from "@mariozechner/pi-coding-agent";
import { describe, expect, it } from "vitest";
import {
  buildCacheSafeForkContext,
  persistSavedRequestContext,
  serializeSavedRequestContext,
} from "./fork-context.js";

function textOf(message: AgentMessage | undefined): string {
  const content = message?.content;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter(
        (block): block is { type: "text"; text: string } =>
          Boolean(block) &&
          typeof block === "object" &&
          "type" in block &&
          block.type === "text" &&
          "text" in block &&
          typeof block.text === "string",
      )
      .map((block) => block.text)
      .join("\n");
  }
  return "";
}

describe("cache-safe fork context", () => {
  it("reuses saved serialized messages when they exist", () => {
    const sessionManager = SessionManager.inMemory();
    sessionManager.appendMessage({ role: "user", content: "rebuild me" } as never);

    const saved = serializeSavedRequestContext({
      promptId: "prompt-1",
      requestId: "run-1",
      recordedAt: 1,
      sessionId: "session-1",
      provider: "anthropic",
      modelId: "claude",
      modelApi: "anthropic-messages",
      wasPostCompaction: false,
      system: "system",
      messages: [{ role: "user", content: "reuse me" } as AgentMessage],
    });
    if (!saved) {
      throw new Error("expected saved context");
    }
    persistSavedRequestContext(sessionManager, saved);

    const result = buildCacheSafeForkContext({
      sessionManager,
      taskId: "default",
      system: "fork system",
    });

    expect(result.reusedSavedPrefix).toBe(true);
    expect(result.partialAssistantStripped).toBe(false);
    expect(textOf(result.messages[0])).toBe("reuse me");
  });

  it("falls back to rebuilding history when no saved prefix exists", () => {
    const sessionManager = SessionManager.inMemory();
    sessionManager.appendMessage({ role: "user", content: "hello" } as never);
    sessionManager.appendMessage({
      role: "assistant",
      content: "world",
      stopReason: "stop",
    } as never);

    const result = buildCacheSafeForkContext({
      sessionManager,
      taskId: "default",
      system: "fork system",
    });

    expect(result.reusedSavedPrefix).toBe(false);
    expect(result.partialAssistantStripped).toBe(false);
    expect(result.messages).toHaveLength(2);
    expect(textOf(result.messages[0])).toBe("hello");
    expect(textOf(result.messages[1])).toBe("world");
  });

  it("strips an incomplete trailing assistant turn before forking", () => {
    const sessionManager = SessionManager.inMemory();
    sessionManager.appendMessage({ role: "user", content: "hello" } as never);
    sessionManager.appendMessage({
      role: "assistant",
      content: "partial",
      stopReason: "aborted",
    } as never);

    const result = buildCacheSafeForkContext({
      sessionManager,
      taskId: "default",
      system: "fork system",
    });

    expect(result.reusedSavedPrefix).toBe(false);
    expect(result.partialAssistantStripped).toBe(true);
    expect(result.messages).toHaveLength(1);
    expect(textOf(result.messages[0])).toBe("hello");
  });

  it("rebuilds only the post-compaction effective context", () => {
    const sessionManager = SessionManager.inMemory();
    const dropUserId = sessionManager.appendMessage({
      role: "user",
      content: "drop me",
    } as never);
    sessionManager.appendMessage({
      role: "assistant",
      content: "drop reply",
      stopReason: "stop",
    } as never);
    const keepUserId = sessionManager.appendMessage({
      role: "user",
      content: "keep me",
    } as never);
    sessionManager.appendMessage({
      role: "assistant",
      content: "keep reply",
      stopReason: "stop",
    } as never);
    sessionManager.appendCompaction("compacted earlier", keepUserId, 42);

    const result = buildCacheSafeForkContext({
      sessionManager,
      taskId: "default",
      system: "fork system",
    });

    const texts = result.messages.map((message) => textOf(message)).filter(Boolean);
    expect(result.reusedSavedPrefix).toBe(false);
    expect(texts.join("\n")).toContain("keep me");
    expect(texts.join("\n")).toContain("keep reply");
    expect(texts.join("\n")).not.toContain("drop me");
    expect(texts.join("\n")).not.toContain("drop reply");
    expect(dropUserId).not.toBe(keepUserId);
  });
});
