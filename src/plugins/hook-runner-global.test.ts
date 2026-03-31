import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { afterEach, describe, expect, it } from "vitest";
import { getGlobalHookRunner, resetGlobalHookRunner } from "./hook-runner-global.js";
import { createNoopHookRunner } from "./hooks.js";

afterEach(() => {
  resetGlobalHookRunner();
});

describe("noop hook runner", () => {
  it("is callable and side-effect free", async () => {
    const runner = createNoopHookRunner();
    const message = {
      role: "toolResult",
      toolCallId: "call_1",
      isError: false,
      content: [{ type: "text", text: "ok" }],
    } as AgentMessage;

    await expect(
      runner.runBeforeAgentStart({ prompt: "hi", messages: [] }, { agentId: "main" }),
    ).resolves.toBeUndefined();
    await expect(
      runner.runBeforeToolCall(
        { toolName: "read", params: { path: "/tmp/file" } },
        { toolName: "read", agentId: "main" },
      ),
    ).resolves.toBeUndefined();
    await expect(
      runner.runAgentEnd({ messages: [], success: true }, { agentId: "main" }),
    ).resolves.toBeUndefined();
    expect(
      runner.runToolResultPersist(
        { toolName: "read", toolCallId: "call_1", message },
        { agentId: "main", toolName: "read", toolCallId: "call_1" },
      ),
    ).toBeUndefined();
    expect(runner.hasHooks("before_tool_call")).toBe(false);
    expect(runner.getHookCount("before_tool_call")).toBe(0);
  });
});

describe("global hook runner", () => {
  it("stays callable before plugin initialization", async () => {
    resetGlobalHookRunner();
    const runner = getGlobalHookRunner();

    expect(runner.hasHooks("message_received")).toBe(false);
    await expect(
      runner.runMessageReceived(
        { from: "user", content: "hello" },
        { channelId: "telegram", conversationId: "chat-1" },
      ),
    ).resolves.toBeUndefined();
  });
});
