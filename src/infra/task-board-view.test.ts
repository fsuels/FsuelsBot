import { describe, expect, it } from "vitest";
import {
  buildTaskBoardSnapshot,
  getTaskBoardTaskDetail,
  renderTaskBoardList,
  renderTaskBoardTaskDetail,
  type RawTaskBoard,
} from "./task-board-view.js";

function buildBoard(): RawTaskBoard {
  return {
    version: 97,
    updated_at: "2026-03-31T12:34:56.000Z",
    lanes: {
      bot_current: ["1"],
      bot_queue: ["2", "3", "6", "10"],
      human: ["11"],
      paused: ["7"],
      done_today: ["10"],
      trash: ["5"],
    },
    tasks: {
      "1": {
        title: "Active task",
        status: "in_progress",
        lane: "bot_queue",
        summary: "This is currently running.",
      },
      "2": {
        title: "Blocked on another task",
        status: "pending",
        blocked_by: ["10", "3"],
        blockers: ["resolved: old blocker", "Waiting on task 3"],
        next_action: "Wait for task 3 to finish.",
      },
      "3": {
        title: "Ready task",
        status: "pending",
        summary: "Can start immediately.",
        steps: [
          { id: "s1", text: "Do the thing", status: "done", checked: true },
          { id: "s2", text: "Verify the thing", status: "todo", checked: false },
        ],
        current_step: 1,
        file: "memory/tasks/3.md",
        plan: "memory/tasks/3-plan.md",
      },
      "4": {
        title: "Internal task",
        status: "pending",
        internal: true,
      },
      "5": {
        title: "Trash task",
        status: "trashed",
      },
      "6": {
        title: "Claimed task",
        status: "pending",
        claimed_by: {
          agent_id: "agent:research",
        },
      },
      "7": {
        title: "Paused task",
        status: "paused",
        blocker: "Paused by operator.",
      },
      "10": {
        title: "Completed dependency",
        status: "done",
      },
      "11": {
        title: "Needs human approval",
        status: "waiting_human",
        blocker: "Need approval from Francisco.",
      },
    },
  };
}

describe("task-board-view", () => {
  it("filters hidden tasks and reconciles lane membership from top-level lanes", () => {
    const snapshot = buildTaskBoardSnapshot(buildBoard());

    expect(snapshot.tasks.map((task) => task.id)).toEqual(["1", "2", "3", "6", "7", "10", "11"]);
    expect(snapshot.tasks.find((task) => task.id === "1")?.lane).toBe("bot_current");
    expect(snapshot.tasks.find((task) => task.id === "1")?.rawLane).toBe("bot_queue");
  });

  it("removes completed blockers and computes availability and summary counts", () => {
    const snapshot = buildTaskBoardSnapshot(buildBoard());
    const blocked = snapshot.tasks.find((task) => task.id === "2");
    const ready = snapshot.tasks.find((task) => task.id === "3");
    const claimed = snapshot.tasks.find((task) => task.id === "6");

    expect(blocked).toMatchObject({
      status: "blocked",
      blockedBy: ["3"],
      blockers: ["Waiting on task 3"],
      isAvailableToClaim: false,
      readyReason: "blocked_by_tasks",
    });
    expect(ready).toMatchObject({
      status: "pending",
      isAvailableToClaim: true,
      isReady: true,
      stepCount: 2,
      stepsDone: 1,
    });
    expect(claimed).toMatchObject({
      hasOwner: true,
      isAvailableToClaim: false,
      readyReason: "claimed",
    });
    expect(snapshot.summary).toEqual({
      total: 7,
      pending: 2,
      in_progress: 1,
      completed: 1,
      blocked: 3,
      available: 1,
    });
  });

  it("keeps blocked distinct from needs-human and removes resolved blocker notes", () => {
    const snapshot = buildTaskBoardSnapshot({
      lanes: {
        bot_queue: ["20", "21"],
      },
      tasks: {
        "20": {
          title: "Blocked by status only",
          status: "blocked",
          blockers: ["Need API key", "resolved: Need API key"],
        },
        "21": {
          title: "Needs human",
          status: "waiting_human",
          blocker: "Approve deployment window",
        },
      },
    });

    expect(snapshot.tasks.find((task) => task.id === "20")).toMatchObject({
      status: "blocked",
      needsHuman: false,
      blockers: [],
      readyReason: "blocked",
    });
    expect(snapshot.tasks.find((task) => task.id === "21")).toMatchObject({
      status: "blocked",
      needsHuman: true,
      blockers: ["Approve deployment window"],
      readyReason: "needs_human",
    });
  });

  it("sorts ids deterministically and renders normalized task data", () => {
    const snapshot = buildTaskBoardSnapshot(buildBoard());
    const rendered = renderTaskBoardList(snapshot);

    expect(snapshot.tasks.map((task) => task.id)).toEqual(["1", "2", "3", "6", "7", "10", "11"]);
    expect(rendered).toContain(
      "- total=7 pending=2 in_progress=1 completed=1 blocked=3 available=1",
    );
    expect(rendered).toContain(
      "- 3 | Ready task | status=pending | lane=bot_queue | ready=yes | owner=none | blocked_by=none | blockers=none",
    );
    expect(rendered).toContain(
      "- 2 | Blocked on another task | status=blocked | lane=bot_queue | ready=no | owner=none | blocked_by=3 | blockers=Waiting on task 3",
    );
    expect(rendered).toContain("Use task_get with a task id for the full task card before acting.");
  });

  it("builds task detail output from the normalized snapshot", () => {
    const board = buildBoard();
    const snapshot = buildTaskBoardSnapshot(board);
    const detail = getTaskBoardTaskDetail({
      board,
      snapshot,
      taskId: "3",
    });

    expect(detail).toMatchObject({
      id: "3",
      title: "Ready task",
      status: "pending",
      isAvailableToClaim: true,
      file: "memory/tasks/3.md",
      plan: "memory/tasks/3-plan.md",
      currentStep: 1,
      current_step: 1,
    });
    expect(detail?.steps).toHaveLength(2);

    const rendered = renderTaskBoardTaskDetail(detail!);
    expect(rendered).toContain("Task 3: Ready task");
    expect(rendered).toContain("Ready: yes (ready) | Owner: none");
    expect(rendered).toContain("Task file: memory/tasks/3.md");
    expect(rendered).toContain("Plan file: memory/tasks/3-plan.md");
  });
});
