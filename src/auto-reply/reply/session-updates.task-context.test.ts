import { describe, expect, it } from "vitest";

import type { SessionEntry } from "../../config/sessions/types.js";
import { incrementCompactionCount } from "./session-updates.js";

describe("incrementCompactionCount task context", () => {
  it("increments only the selected task compaction counter", async () => {
    const sessionKey = "agent:main:main";
    const sessionStore: Record<string, SessionEntry> = {
      [sessionKey]: {
        sessionId: "session-1",
        updatedAt: 10,
        activeTaskId: "task-a",
        compactionCount: 2,
        taskStateById: {
          "task-a": { updatedAt: 10, compactionCount: 2, totalTokens: 80 },
          "task-b": { updatedAt: 10, compactionCount: 0, totalTokens: 10 },
        },
      },
    };

    const nextCount = await incrementCompactionCount({
      sessionStore,
      sessionKey,
      taskId: "task-b",
    });

    expect(nextCount).toBe(1);
    expect(sessionStore[sessionKey].activeTaskId).toBe("task-b");
    expect(sessionStore[sessionKey].compactionCount).toBe(1);
    expect(sessionStore[sessionKey].taskStateById?.["task-a"]?.compactionCount).toBe(2);
    expect(sessionStore[sessionKey].taskStateById?.["task-b"]?.compactionCount).toBe(1);
  });
});
