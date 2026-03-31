import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadTaskTrackerState,
  replaceTaskTrackerState,
  resolveTaskTrackerStatePath,
  type TaskTrackerContext,
  type TaskTrackerTaskInput,
} from "./task-tracker.js";

function makeTask(
  partial: Partial<TaskTrackerTaskInput> &
    Pick<TaskTrackerTaskInput, "id" | "content" | "activeForm">,
): TaskTrackerTaskInput {
  return {
    status: "pending",
    type: "implementation",
    ...partial,
  };
}

describe("task-tracker", () => {
  let tmpDir = "";

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-task-tracker-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  function makeContext(agentId: string, sessionId: string): TaskTrackerContext {
    return {
      agentId,
      sessionId,
      sessionsDir: path.join(tmpDir, agentId),
    };
  }

  it("rejects invalid task-state transitions from completed back to pending", async () => {
    const context = makeContext("main", "sess-completed");

    await replaceTaskTrackerState({
      context,
      tasks: [
        makeTask({
          id: "impl-1",
          content: "Implement auth",
          activeForm: "Implementing auth",
          status: "completed",
        }),
      ],
    });

    await expect(
      replaceTaskTrackerState({
        context,
        tasks: [
          makeTask({
            id: "impl-1",
            content: "Implement auth",
            activeForm: "Implementing auth",
            status: "pending",
          }),
        ],
      }),
    ).rejects.toThrow(/Invalid task transition/i);
  });

  it("rejects updates with more than one in_progress task", async () => {
    const context = makeContext("main", "sess-multi");

    await expect(
      replaceTaskTrackerState({
        context,
        tasks: [
          makeTask({
            id: "impl-1",
            content: "Implement auth",
            activeForm: "Implementing auth",
            status: "in_progress",
          }),
          makeTask({
            id: "test-1",
            content: "Run tests",
            activeForm: "Running tests",
            type: "test",
            status: "in_progress",
          }),
        ],
      }),
    ).rejects.toThrow(/one task may be in_progress/i);
  });

  it("auto-creates a follow_up task when work becomes blocked", async () => {
    const context = makeContext("main", "sess-blocked");

    const result = await replaceTaskTrackerState({
      context,
      tasks: [
        makeTask({
          id: "impl-1",
          content: "Ship auth fix",
          activeForm: "Shipping auth fix",
          status: "blocked",
          blockedReason: "Missing staging credentials",
          unblockAction: "Ask for staging credentials",
        }),
      ],
    });

    expect(result.state.sessionState).toBe("blocked");
    expect(result.autoCreatedTasks).toHaveLength(1);
    expect(result.autoCreatedTasks[0]?.type).toBe("follow_up");
    expect(result.autoCreatedTasks[0]?.content).toBe("Ask for staging credentials");
    expect(result.state.activeTasks.some((task) => task.type === "follow_up")).toBe(true);
    expect(result.state.activeTasks.find((task) => task.id === "impl-1")?.followUpTaskId).toBe(
      result.autoCreatedTasks[0]?.id,
    );
  });

  it("allows blocked work to return to in_progress", async () => {
    const context = makeContext("main", "sess-unblock");

    const blocked = await replaceTaskTrackerState({
      context,
      tasks: [
        makeTask({
          id: "impl-1",
          content: "Ship auth fix",
          activeForm: "Shipping auth fix",
          status: "blocked",
          blockedReason: "Missing staging credentials",
          unblockAction: "Ask for staging credentials",
        }),
      ],
    });

    const resumed = await replaceTaskTrackerState({
      context,
      tasks: [
        {
          ...blocked.state.activeTasks.find((task) => task.id === "impl-1")!,
          status: "in_progress",
        },
      ],
    });

    expect(resumed.state.sessionState).toBe("active");
    expect(resumed.state.activeTasks).toHaveLength(1);
    expect(resumed.state.activeTasks[0]?.status).toBe("in_progress");
  });

  it("keeps session and agent tracker state isolated", async () => {
    const mainContext = makeContext("main", "sess-a");
    const opsContext = makeContext("ops", "sess-b");

    await replaceTaskTrackerState({
      context: mainContext,
      tasks: [
        makeTask({
          id: "impl-main",
          content: "Update docs",
          activeForm: "Updating docs",
          status: "in_progress",
        }),
      ],
    });
    await replaceTaskTrackerState({
      context: opsContext,
      tasks: [
        makeTask({
          id: "impl-ops",
          content: "Rotate logs",
          activeForm: "Rotating logs",
          status: "in_progress",
        }),
      ],
    });

    const mainState = await loadTaskTrackerState(mainContext);
    const opsState = await loadTaskTrackerState(opsContext);

    expect(mainState.activeTasks.map((task) => task.id)).toEqual(["impl-main"]);
    expect(opsState.activeTasks.map((task) => task.id)).toEqual(["impl-ops"]);
    expect(resolveTaskTrackerStatePath(mainContext)).not.toBe(
      resolveTaskTrackerStatePath(opsContext),
    );
  });

  it("blocks terminal completion until a verification task exists when 3+ tasks complete", async () => {
    const context = makeContext("main", "sess-verify");

    const first = await replaceTaskTrackerState({
      context,
      tasks: [
        makeTask({
          id: "impl-1",
          content: "Implement feature",
          activeForm: "Implementing feature",
          status: "completed",
        }),
        makeTask({
          id: "test-1",
          content: "Run tests",
          activeForm: "Running tests",
          type: "test",
          status: "completed",
        }),
        makeTask({
          id: "impl-2",
          content: "Update docs",
          activeForm: "Updating docs",
          status: "completed",
        }),
      ],
    });

    expect(first.finalizationBlocked).toBe(true);
    expect(first.state.sessionState).toBe("active");
    expect(first.state.archivedTasks).toHaveLength(3);
    expect(first.state.activeTasks).toHaveLength(1);
    expect(first.state.activeTasks[0]?.type).toBe("verification");

    const verificationTask = first.state.activeTasks[0]!;
    const finished = await replaceTaskTrackerState({
      context,
      tasks: [{ ...verificationTask, status: "completed" }],
    });

    expect(finished.finalizationBlocked).toBe(false);
    expect(finished.state.sessionState).toBe("done");
    expect(finished.state.activeTasks).toEqual([]);
    expect(finished.state.archivedTasks.some((task) => task.type === "verification")).toBe(true);
  });

  it("does not treat empty input as implicit terminal success", async () => {
    const context = makeContext("main", "sess-empty");

    const result = await replaceTaskTrackerState({
      context,
      tasks: [],
    });

    expect(result.state.sessionState).toBe("active");
    expect(result.state.activeTasks).toEqual([]);
    expect(result.state.archivedTasks).toEqual([]);
    expect(result.state.submittedTasks).toEqual([]);
  });
});
