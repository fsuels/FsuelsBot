import { describe, expect, it } from "vitest";
import { sanitizeTranscriptMessagesForReplay } from "./tool-result-replay.js";

describe("sanitizeTranscriptMessagesForReplay", () => {
  it("replaces invalid typed tool details with a non-fatal replay warning", () => {
    const result = sanitizeTranscriptMessagesForReplay({
      cfg: {},
      messages: [
        {
          role: "assistant",
          content: [{ type: "toolCall", id: "call_1", name: "agents_list", arguments: {} }],
        },
        {
          role: "toolResult",
          toolCallId: "call_1",
          content: [{ type: "text", text: "raw output" }],
          details: { requester: "main", allowAny: "nope", agents: [] },
        },
      ],
    });

    expect(result.warningCount).toBe(1);
    const toolResult = result.messages[1] as Record<string, unknown>;
    expect(toolResult.toolName).toBe("agents_list");
    expect(toolResult.details).toMatchObject({
      status: "replay_warning",
      replayWarning: true,
      tool: "agents_list",
    });
    expect((toolResult.__openclaw as Record<string, unknown>)?.replayWarning).toMatchObject({
      kind: "tool_result_schema_mismatch",
      toolName: "agents_list",
      toolCallId: "call_1",
    });
  });

  it("preserves valid typed tool details and infers the tool name from the call id", () => {
    const result = sanitizeTranscriptMessagesForReplay({
      cfg: {},
      messages: [
        {
          role: "assistant",
          content: [{ type: "toolCall", id: "call_2", name: "agents_list", arguments: {} }],
        },
        {
          role: "toolResult",
          toolCallId: "call_2",
          content: [{ type: "text", text: "ok" }],
          details: {
            requester: "main",
            allowAny: false,
            agents: [{ id: "main", configured: false }],
          },
        },
      ],
    });

    expect(result.warningCount).toBe(0);
    const toolResult = result.messages[1] as Record<string, unknown>;
    expect(toolResult.toolName).toBe("agents_list");
    expect(toolResult.details).toEqual({
      requester: "main",
      allowAny: false,
      agents: [{ id: "main", configured: false }],
    });
  });
});
