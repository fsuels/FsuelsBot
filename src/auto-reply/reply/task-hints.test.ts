import { describe, expect, it } from "vitest";

import type { SessionEntry } from "../../config/sessions/types.js";
import { inferTaskHintFromMessage } from "./task-hints.js";

describe("task hints", () => {
  it("infers a task from title/token overlap", () => {
    const entry: SessionEntry = {
      sessionId: "s1",
      updatedAt: Date.now(),
      activeTaskId: "default",
      taskStateById: {
        default: { updatedAt: Date.now(), status: "active" },
        "task-auth": { updatedAt: Date.now(), status: "paused", title: "Fix auth flow" },
        "task-ui": { updatedAt: Date.now(), status: "active", title: "Polish mobile UI" },
      },
    };
    const inferred = inferTaskHintFromMessage({
      entry,
      message: "Please continue the auth flow and fix login token handling.",
    });
    expect(inferred?.taskId).toBe("task-auth");
    expect((inferred?.score ?? 0) > 0.6).toBe(true);
  });

  it("ignores archived/completed tasks", () => {
    const entry: SessionEntry = {
      sessionId: "s2",
      updatedAt: Date.now(),
      activeTaskId: "default",
      taskStateById: {
        default: { updatedAt: Date.now(), status: "active" },
        closed: { updatedAt: Date.now(), status: "completed", title: "Fix auth flow" },
      },
    };
    const inferred = inferTaskHintFromMessage({
      entry,
      message: "continue auth flow",
    });
    expect(inferred).toBeNull();
  });
});
