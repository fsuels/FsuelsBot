import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { describe, expect, it } from "vitest";
import {
  extractAssistantToolCallRecords,
  extractToolResultCorrelationId,
  resolveToolResultCorrelation,
} from "./tool-call-correlation.js";

describe("tool-call-correlation", () => {
  it("keeps repeated tool names distinct by emitted id", () => {
    const message = {
      role: "assistant",
      id: "msg-1",
      stopReason: "toolUse",
      content: [
        { type: "toolCall", id: "call_a", name: "read", arguments: { path: "a" } },
        { type: "toolUse", id: "call_b", name: "read", input: { path: "b" } },
        { type: "text", text: "done" },
      ],
    } as AgentMessage & { id: string };

    expect(extractAssistantToolCallRecords(message)).toEqual([
      {
        toolCallId: "call_a",
        toolName: "read",
        indexWithinMessage: 0,
        parentMessageId: "msg-1",
        status: "toolUse",
      },
      {
        toolCallId: "call_b",
        toolName: "read",
        indexWithinMessage: 1,
        parentMessageId: "msg-1",
        status: "toolUse",
      },
    ]);
  });

  it("prefers toolCallId and falls back to toolUseId", () => {
    expect(resolveToolResultCorrelation({ toolCallId: "call_1", toolUseId: "use_1" })).toEqual({
      toolCallId: "call_1",
      source: "toolCallId",
    });
    expect(resolveToolResultCorrelation({ toolUseId: "use_2" })).toEqual({
      toolCallId: "use_2",
      source: "toolUseId",
    });
    expect(extractToolResultCorrelationId({ toolUseId: "use_3" })).toBe("use_3");
    expect(extractToolResultCorrelationId({})).toBeNull();
  });
});
