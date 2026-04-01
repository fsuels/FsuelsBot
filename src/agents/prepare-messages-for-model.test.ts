import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { SessionManager } from "@mariozechner/pi-coding-agent";
import { describe, expect, it } from "vitest";
import {
  PrepareMessagesForModelError,
  prepareMessagesForModel,
} from "./prepare-messages-for-model.js";

function textMessage(role: "user" | "assistant", text: string): AgentMessage {
  return {
    role,
    content: [{ type: "text", text }],
    timestamp: Date.now(),
  } as AgentMessage;
}

function toolResultIds(messages: AgentMessage[]): string[] {
  return messages
    .filter((message) => message.role === "toolResult")
    .map((message) => {
      const record = message as { toolCallId?: string; toolUseId?: string };
      return record.toolCallId ?? record.toolUseId ?? "";
    });
}

describe("prepareMessagesForModel", () => {
  it("inserts a synthetic tool result for interrupted tool calls", async () => {
    const sessionManager = SessionManager.inMemory();
    const messages = [
      {
        role: "assistant",
        content: [{ type: "toolUse", id: "call_1", name: "read", input: { path: "README.md" } }],
      },
      textMessage("user", "continue"),
    ] satisfies AgentMessage[];

    const result = await prepareMessagesForModel({
      messages,
      sessionManager,
      sessionId: "session-interrupted",
      provider: "anthropic",
      modelApi: "anthropic-messages",
      sanitizeOptions: { recordModelSnapshot: false },
    });

    expect(result.messages.map((message) => message.role)).toEqual([
      "assistant",
      "toolResult",
      "user",
    ]);
    const toolResult = result.messages[1] as Extract<AgentMessage, { role: "toolResult" }>;
    expect(toolResult.isError).toBe(true);
    expect(toolResult.toolCallId).toBe("call_1");
  });

  it("drops orphan tool results at the start of resumed transcripts", async () => {
    const sessionManager = SessionManager.inMemory();
    const messages = [
      {
        role: "toolResult",
        toolCallId: "call_orphan",
        toolName: "read",
        content: [{ type: "text", text: "stale result" }],
      },
      textMessage("user", "hello"),
    ] satisfies AgentMessage[];

    const result = await prepareMessagesForModel({
      messages,
      sessionManager,
      sessionId: "session-orphan",
      provider: "anthropic",
      modelApi: "anthropic-messages",
      sanitizeOptions: { recordModelSnapshot: false },
    });

    expect(result.messages.map((message) => message.role)).toEqual(["user"]);
    expect(result.repairCategories).toContain("orphan_tool_result_removed");
  });

  it("drops duplicate tool result ids while keeping the first result", async () => {
    const sessionManager = SessionManager.inMemory();
    const messages = [
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "call_1", name: "read", arguments: {} }],
      },
      {
        role: "toolResult",
        toolCallId: "call_1",
        toolName: "read",
        content: [{ type: "text", text: "first" }],
      },
      {
        role: "toolResult",
        toolCallId: "call_1",
        toolName: "read",
        content: [{ type: "text", text: "duplicate" }],
      },
    ] satisfies AgentMessage[];

    const result = await prepareMessagesForModel({
      messages,
      sessionManager,
      sessionId: "session-duplicate-result",
      provider: "anthropic",
      modelApi: "anthropic-messages",
      sanitizeOptions: { recordModelSnapshot: false },
    });

    expect(result.messages.filter((message) => message.role === "toolResult")).toHaveLength(1);
    expect(result.repairCategories).toContain("duplicate_tool_result_removed");
  });

  it("rewrites duplicate tool call ids and remaps tool results in order", async () => {
    const sessionManager = SessionManager.inMemory();
    const messages = [
      {
        role: "assistant",
        content: [
          { type: "toolCall", id: "call_1", name: "read", arguments: {} },
          { type: "toolCall", id: "call_1", name: "write", arguments: {} },
        ],
      },
      {
        role: "toolResult",
        toolCallId: "call_1",
        toolName: "read",
        content: [{ type: "text", text: "first" }],
      },
      {
        role: "toolResult",
        toolCallId: "call_1",
        toolName: "write",
        content: [{ type: "text", text: "second" }],
      },
    ] satisfies AgentMessage[];

    const result = await prepareMessagesForModel({
      messages,
      sessionManager,
      sessionId: "session-duplicate-call",
      provider: "anthropic",
      modelApi: "anthropic-messages",
      sanitizeOptions: { recordModelSnapshot: false },
    });

    const assistant = result.messages[0] as Extract<AgentMessage, { role: "assistant" }>;
    const ids = assistant.content
      .filter((block) => !!block && typeof block === "object" && "id" in block)
      .map((block) => (block as { id?: string }).id ?? "");
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
    expect(toolResultIds(result.messages)).toEqual(ids);
    expect(result.repairCategories).toContain("duplicate_tool_call_id_rewritten");
    expect(result.repairCategories).toContain("duplicate_tool_result_id_rewritten");
  });

  it("removes whitespace-only assistant messages", async () => {
    const sessionManager = SessionManager.inMemory();
    const messages = [
      textMessage("user", "hello"),
      {
        role: "assistant",
        content: [{ type: "text", text: "   " }],
      },
      textMessage("assistant", "kept"),
    ] satisfies AgentMessage[];

    const result = await prepareMessagesForModel({
      messages,
      sessionManager,
      sessionId: "session-whitespace",
      provider: "openai",
      modelApi: "openai-responses",
      sanitizeOptions: { recordModelSnapshot: false },
    });

    expect(result.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(result.repairCategories).toContain("assistant_whitespace_removed");
  });

  it("drops orphan reasoning-only assistant blocks after provider switches", async () => {
    const sessionManager = SessionManager.inMemory();
    sessionManager.appendCustomEntry("model-snapshot", {
      timestamp: Date.now(),
      provider: "anthropic",
      modelApi: "anthropic-messages",
      modelId: "claude-3-7",
    });
    const messages = [
      {
        role: "assistant",
        content: [
          {
            type: "thinking",
            thinking: "internal",
            thinkingSignature: { id: "rs_test", type: "reasoning" },
          },
        ],
      },
    ] satisfies AgentMessage[];

    const result = await prepareMessagesForModel({
      messages,
      sessionManager,
      sessionId: "session-reasoning-only",
      provider: "openai",
      modelApi: "openai-responses",
      modelId: "gpt-5.2-codex",
      sanitizeOptions: { recordModelSnapshot: false },
    });

    expect(result.sanitizedMessages).toEqual([]);
    expect(result.messages).toEqual([]);
  });

  it("merges consecutive user turns after tool result repair", async () => {
    const sessionManager = SessionManager.inMemory();
    const messages = [
      {
        role: "assistant",
        content: [{ type: "toolUse", id: "call_1", name: "read", input: { path: "README.md" } }],
      },
      textMessage("user", "first follow-up"),
      {
        role: "toolResult",
        toolCallId: "call_1",
        toolName: "read",
        content: [{ type: "text", text: "ok" }],
      },
      textMessage("user", "second follow-up"),
    ] satisfies AgentMessage[];

    const result = await prepareMessagesForModel({
      messages,
      sessionManager,
      sessionId: "session-consecutive-users",
      provider: "anthropic",
      modelApi: "anthropic-messages",
      sanitizeOptions: { recordModelSnapshot: false },
    });

    expect(result.messages.map((message) => message.role)).toEqual([
      "assistant",
      "toolResult",
      "user",
    ]);
    const user = result.messages[2] as Extract<AgentMessage, { role: "user" }>;
    expect(Array.isArray(user.content)).toBe(true);
    expect((user.content as Array<unknown>).length).toBe(2);
    expect(result.repairCategories).toContain("user_turns_merged");
  });

  it("throws in strict mode instead of repairing", async () => {
    const sessionManager = SessionManager.inMemory();
    const messages = [
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "call_1", name: "read", arguments: {} }],
      },
      {
        role: "toolResult",
        toolCallId: "call_1",
        toolName: "read",
        content: [{ type: "text", text: "first" }],
      },
      {
        role: "toolResult",
        toolCallId: "call_1",
        toolName: "read",
        content: [{ type: "text", text: "duplicate" }],
      },
    ] satisfies AgentMessage[];

    await expect(
      prepareMessagesForModel({
        messages,
        sessionManager,
        sessionId: "session-strict",
        provider: "anthropic",
        modelApi: "anthropic-messages",
        mode: "strict",
        sanitizeOptions: { recordModelSnapshot: false },
      }),
    ).rejects.toBeInstanceOf(PrepareMessagesForModelError);
  });

  it("is idempotent for already-normalized output", async () => {
    const sessionManager = SessionManager.inMemory();
    const messages = [
      textMessage("user", "hello"),
      textMessage("assistant", "world"),
    ] satisfies AgentMessage[];

    const once = await prepareMessagesForModel({
      messages,
      sessionManager,
      sessionId: "session-idempotent-1",
      provider: "anthropic",
      modelApi: "anthropic-messages",
      sanitizeOptions: { recordModelSnapshot: false },
    });
    const twice = await prepareMessagesForModel({
      messages: once.messages,
      sessionManager,
      sessionId: "session-idempotent-2",
      provider: "anthropic",
      modelApi: "anthropic-messages",
      sanitizeOptions: { recordModelSnapshot: false },
    });

    expect(twice.messages).toEqual(once.messages);
    expect(twice.repairCategories).toEqual([]);
  });
});
