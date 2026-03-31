import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  evaluateTaskCardCompletionGuards,
  patchTaskCard,
  resolveActiveTask,
} from "./task-checkpoint.js";

type TestTaskBoard = {
  version?: number;
  tasks: Record<string, { goal?: string; summary?: string }>;
};

async function createWorkspaceWithTasks(board: Record<string, unknown>): Promise<string> {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-task-checkpoint-"));
  const boardPath = path.join(workspaceDir, "memory", "tasks.json");
  await fs.mkdir(path.dirname(boardPath), { recursive: true });
  await fs.writeFile(boardPath, `${JSON.stringify(board, null, 2)}\n`, "utf-8");
  return workspaceDir;
}

async function readTasksJson(workspaceDir: string): Promise<TestTaskBoard> {
  const boardPath = path.join(workspaceDir, "memory", "tasks.json");
  return JSON.parse(await fs.readFile(boardPath, "utf-8")) as TestTaskBoard;
}

const createdWorkspaces: string[] = [];

afterEach(async () => {
  while (createdWorkspaces.length > 0) {
    const workspaceDir = createdWorkspaces.pop();
    if (!workspaceDir) {
      continue;
    }
    await fs.rm(workspaceDir, { recursive: true, force: true });
  }
});

describe("task-checkpoint", () => {
  it("patches only changed fields and bumps the board revision", async () => {
    const workspaceDir = await createWorkspaceWithTasks({
      version: 7,
      updated_at: "2026-03-31T00:00:00.000Z",
      lanes: { bot_current: ["task-a"] },
      tasks: {
        "task-a": {
          title: "Task A",
          summary: "Keep this summary",
          goal: "Old goal",
          steps: [{ id: "s1", text: "Ship it", status: "todo", checked: false }],
        },
      },
    });
    createdWorkspaces.push(workspaceDir);

    const result = await patchTaskCard({
      workspaceDir,
      taskId: "task-a",
      expectedRevision: 7,
      patch: {
        goal: "New goal",
        summary: "Keep this summary",
      },
    });

    expect(result).toMatchObject({
      success: true,
      taskId: "task-a",
      updatedFields: ["goal"],
      revision: 8,
    });

    const saved = await readTasksJson(workspaceDir);
    expect(saved.version).toBe(8);
    expect(saved.tasks["task-a"].goal).toBe("New goal");
    expect(saved.tasks["task-a"].summary).toBe("Keep this summary");
  });

  it("treats same-value patches as no-ops", async () => {
    const workspaceDir = await createWorkspaceWithTasks({
      version: 3,
      updated_at: "2026-03-31T00:00:00.000Z",
      lanes: { bot_current: ["task-a"] },
      tasks: {
        "task-a": {
          title: "Task A",
          goal: "Stable goal",
        },
      },
    });
    createdWorkspaces.push(workspaceDir);

    const result = await patchTaskCard({
      workspaceDir,
      taskId: "task-a",
      expectedRevision: 3,
      patch: { goal: "Stable goal" },
    });

    expect(result).toMatchObject({
      success: true,
      taskId: "task-a",
      updatedFields: [],
      revision: 3,
    });

    const saved = await readTasksJson(workspaceDir);
    expect(saved.version).toBe(3);
    expect(saved.tasks["task-a"].goal).toBe("Stable goal");
  });

  it("rejects stale revisions without side effects", async () => {
    const workspaceDir = await createWorkspaceWithTasks({
      version: 11,
      updated_at: "2026-03-31T00:00:00.000Z",
      lanes: { bot_current: ["task-a"] },
      tasks: {
        "task-a": {
          title: "Task A",
          goal: "Current goal",
        },
      },
    });
    createdWorkspaces.push(workspaceDir);

    const result = await patchTaskCard({
      workspaceDir,
      taskId: "task-a",
      expectedRevision: 10,
      patch: { goal: "Should not land" },
    });

    expect(result).toMatchObject({
      success: false,
      errorCode: "stale_task",
      currentRevision: 11,
    });

    const saved = await readTasksJson(workspaceDir);
    expect(saved.version).toBe(11);
    expect(saved.tasks["task-a"].goal).toBe("Current goal");
  });

  it("returns structured task_not_found results", async () => {
    const workspaceDir = await createWorkspaceWithTasks({
      version: 2,
      updated_at: "2026-03-31T00:00:00.000Z",
      lanes: { bot_current: [] },
      tasks: {},
    });
    createdWorkspaces.push(workspaceDir);

    const result = await patchTaskCard({
      workspaceDir,
      taskId: "missing-task",
      patch: { goal: "noop" },
    });

    expect(result).toMatchObject({
      success: false,
      taskId: "missing-task",
      errorCode: "task_not_found",
      currentRevision: 2,
    });
  });

  it("blocks completion when steps or blockers remain", async () => {
    const workspaceDir = await createWorkspaceWithTasks({
      version: 4,
      updated_at: "2026-03-31T00:00:00.000Z",
      lanes: { bot_current: ["task-a"] },
      tasks: {
        "task-a": {
          title: "Task A",
          blockers: ["Need final QA signoff"],
          steps: [
            { id: "s1", text: "Already done", status: "done", checked: true },
            { id: "s2", text: "Ship the change", status: "todo", checked: false },
          ],
        },
      },
    });
    createdWorkspaces.push(workspaceDir);

    const result = await evaluateTaskCardCompletionGuards({
      workspaceDir,
      taskId: "task-a",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected completion guards to fail");
    }
    expect(result.reasons.map((reason) => reason.code)).toEqual([
      "incomplete_steps",
      "open_blockers",
    ]);
  });

  it("normalizes resolved blockers out of readiness and completion guards", async () => {
    const workspaceDir = await createWorkspaceWithTasks({
      version: 5,
      updated_at: "2026-03-31T00:00:00.000Z",
      lanes: { bot_current: ["task-a"] },
      tasks: {
        "task-a": {
          title: "Task A",
          status: "active",
          blockers: ["resolved: Waiting for review", "Waiting for review"],
          steps: [{ id: "s1", text: "Already done", status: "done", checked: true }],
        },
      },
    });
    createdWorkspaces.push(workspaceDir);

    const activeTask = await resolveActiveTask(workspaceDir);
    expect(activeTask).toMatchObject({
      blockers: [],
      resolvedBlockers: ["Waiting for review"],
      canStart: true,
      nextRecommendedAction: "start_task",
    });

    const result = await evaluateTaskCardCompletionGuards({
      workspaceDir,
      taskId: "task-a",
    });

    expect(result).toMatchObject({
      ok: true,
      taskId: "task-a",
    });
  });
});
