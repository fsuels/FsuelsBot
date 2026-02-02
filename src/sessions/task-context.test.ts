import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { SessionManager } from "@mariozechner/pi-coding-agent";
import { describe, expect, it } from "vitest";

import type { SessionEntry } from "../config/sessions/types.js";
import {
  appendTaskContextMarker,
  applySessionTaskUpdate,
  resolveTaskScopedHistoryMessages,
} from "./task-context.js";

function messageText(message: AgentMessage): string {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (block): block is { type?: string; text?: string } =>
        !!block && typeof block === "object" && (block as { type?: unknown }).type === "text",
    )
    .map((block) => block.text ?? "")
    .join(" ")
    .trim();
}

describe("task-context", () => {
  it("falls back to full replay when no task markers exist", () => {
    const sessionManager = SessionManager.inMemory();
    sessionManager.appendMessage({ role: "user", content: [{ type: "text", text: "u1" }] } as AgentMessage);
    sessionManager.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "a1" }],
    } as AgentMessage);
    sessionManager.appendMessage({ role: "user", content: [{ type: "text", text: "u2" }] } as AgentMessage);

    const scoped = resolveTaskScopedHistoryMessages({
      sessionManager,
      taskId: "task-a",
    });

    expect(scoped.scoped).toBe(false);
    expect(scoped.messages.map((message) => messageText(message))).toEqual(["u1", "a1", "u2"]);
  });

  it("filters replay to the requested task id when markers are present", () => {
    const sessionManager = SessionManager.inMemory();
    sessionManager.appendMessage({
      role: "user",
      content: [{ type: "text", text: "legacy-default" }],
    } as AgentMessage);

    appendTaskContextMarker({ sessionManager, taskId: "task-a", source: "test" });
    sessionManager.appendMessage({ role: "user", content: [{ type: "text", text: "a1" }] } as AgentMessage);
    sessionManager.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "a2" }],
    } as AgentMessage);

    appendTaskContextMarker({ sessionManager, taskId: "task-b", source: "test" });
    sessionManager.appendMessage({ role: "user", content: [{ type: "text", text: "b1" }] } as AgentMessage);
    sessionManager.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "b2" }],
    } as AgentMessage);

    appendTaskContextMarker({ sessionManager, taskId: "task-a", source: "test" });
    sessionManager.appendMessage({ role: "user", content: [{ type: "text", text: "a3" }] } as AgentMessage);

    const taskA = resolveTaskScopedHistoryMessages({ sessionManager, taskId: "task-a" });
    const taskB = resolveTaskScopedHistoryMessages({ sessionManager, taskId: "task-b" });

    expect(taskA.scoped).toBe(true);
    expect(taskA.messages.map((message) => messageText(message))).toEqual(["a1", "a2", "a3"]);
    expect(taskB.scoped).toBe(true);
    expect(taskB.messages.map((message) => messageText(message))).toEqual(["b1", "b2"]);
  });

  it("tracks compaction state per task and mirrors active task counters", () => {
    const entry: SessionEntry = {
      sessionId: "session-1",
      updatedAt: 100,
      compactionCount: 2,
      totalTokens: 40,
    };

    const taskA = applySessionTaskUpdate(entry, {
      taskId: "task-a",
      updatedAt: 200,
    });
    const taskB = applySessionTaskUpdate(taskA, {
      taskId: "task-b",
      compactionCount: 1,
      totalTokens: 10,
      updatedAt: 300,
      source: "test",
    });
    const backToTaskA = applySessionTaskUpdate(taskB, {
      taskId: "task-a",
      updatedAt: 400,
    });

    expect(taskB.lastTaskSwitch?.fromTaskId).toBe("task-a");
    expect(taskB.lastTaskSwitch?.toTaskId).toBe("task-b");
    expect(taskB.taskStateById?.["task-a"]?.compactionCount).toBe(2);
    expect(taskB.taskStateById?.["task-b"]?.compactionCount).toBe(1);
    expect(taskB.taskStateById?.["task-b"]?.status).toBe("active");
    expect(taskB.compactionCount).toBe(1);
    expect(backToTaskA.compactionCount).toBe(2);
    expect(backToTaskA.totalTokens).toBe(40);
  });
});
