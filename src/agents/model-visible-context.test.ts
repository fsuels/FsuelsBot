import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { SessionManager } from "@mariozechner/pi-coding-agent";
import { describe, expect, it } from "vitest";
import type { SessionSystemPromptReport } from "../config/sessions/types.js";
import { appendTaskContextMarker } from "../sessions/task-context.js";
import { projectConversationForModel } from "./model-visible-context.js";

function textMessage(role: "user" | "assistant", text: string): AgentMessage {
  return {
    role,
    content: [{ type: "text", text }],
    timestamp: Date.now(),
  } as AgentMessage;
}

function assistantToolCallMessage(toolCallId: string): AgentMessage {
  return {
    role: "assistant",
    content: [
      { type: "text", text: "Calling tool" },
      { type: "toolUse", id: toolCallId, name: "fetch_file", input: { path: "README.md" } },
    ],
    timestamp: Date.now(),
  } as AgentMessage;
}

function toolResultMessage(toolCallId: string, text: string): AgentMessage {
  return {
    role: "toolResult",
    toolCallId,
    toolName: "fetch_file",
    content: [{ type: "text", text }],
    timestamp: Date.now(),
  } as AgentMessage;
}

function messageText(message: AgentMessage): string {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .filter(
      (block): block is { type?: string; text?: string } =>
        !!block && typeof block === "object" && (block as { type?: unknown }).type === "text",
    )
    .map((block) => block.text ?? "")
    .join(" ")
    .trim();
}

function makeSystemPromptReport(params?: {
  systemPromptChars?: number;
  toolSchemaChars?: number;
}): SessionSystemPromptReport {
  return {
    source: "run",
    generatedAt: 0,
    systemPrompt: {
      chars: params?.systemPromptChars ?? 0,
      projectContextChars: 0,
      nonProjectContextChars: params?.systemPromptChars ?? 0,
    },
    injectedWorkspaceFiles: [],
    skills: { promptChars: 0, entries: [] },
    tools: { listChars: 0, schemaChars: params?.toolSchemaChars ?? 0, entries: [] },
  };
}

describe("projectConversationForModel", () => {
  it("projects task-scoped history instead of counting the whole branch", async () => {
    const sessionManager = SessionManager.inMemory();
    sessionManager.appendMessage(textMessage("user", "legacy-default"));

    appendTaskContextMarker({ sessionManager, taskId: "task-a", source: "test" });
    sessionManager.appendMessage(textMessage("user", "task-a-1"));
    sessionManager.appendMessage(textMessage("assistant", "task-a-2"));

    appendTaskContextMarker({ sessionManager, taskId: "task-b", source: "test" });
    sessionManager.appendMessage(textMessage("user", "task-b-1"));

    const projection = await projectConversationForModel({
      sessionManager,
      sessionId: "session-1",
      taskId: "task-a",
      sanitizeOptions: { recordModelSnapshot: false },
    });

    expect(projection.usage.branchHistoryMessages).toBe(4);
    expect(projection.usage.scopedHistoryMessages).toBe(2);
    expect(projection.usage.projectedHistoryMessages).toBe(2);
    expect(projection.usage.taskScoped).toBe(true);
    expect(projection.projectedMessages.map((message) => messageText(message))).toEqual([
      "task-a-1",
      "task-a-2",
    ]);
  });

  it("includes prompt overhead in projected totals and truncates oversized tool results", async () => {
    const sessionManager = SessionManager.inMemory();
    const oversizedToolText = "x".repeat(5_000);

    sessionManager.appendMessage(assistantToolCallMessage("call-1"));
    sessionManager.appendMessage(toolResultMessage("call-1", oversizedToolText));

    const projection = await projectConversationForModel({
      sessionManager,
      sessionId: "session-2",
      contextWindowTokens: 2_000,
      systemPromptReport: makeSystemPromptReport({
        systemPromptChars: 800,
        toolSchemaChars: 400,
      }),
      sanitizeOptions: { recordModelSnapshot: false },
    });

    expect(projection.usage.truncatedToolResults).toBe(1);
    expect(projection.usage.systemPromptTokens).toBe(200);
    expect(projection.usage.toolSchemaTokens).toBe(100);
    expect(projection.usage.projectedHistoryTokens).toBeLessThan(
      projection.usage.branchHistoryTokens,
    );
    expect(projection.usage.projectedTotalTokens).toBe(
      projection.usage.systemPromptTokens +
        projection.usage.toolSchemaTokens +
        projection.usage.projectedHistoryTokens,
    );
    expect(projection.usage.contextPressure).toBeCloseTo(
      Math.min(1, projection.usage.projectedTotalTokens / 2_000),
      5,
    );
    expect(messageText(projection.projectedMessages[1] as AgentMessage)).toContain(
      "Content truncated",
    );
  });
});
