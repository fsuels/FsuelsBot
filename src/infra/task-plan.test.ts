import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  approveTaskPlan,
  getTaskPlan,
  rejectTaskPlan,
  requestTaskPlanApproval,
  saveTaskPlan,
} from "./task-plan.js";

async function createWorkspaceTaskBoard() {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-task-plan-"));
  const tasksPath = path.join(workspaceDir, "memory", "tasks.json");
  await fs.mkdir(path.dirname(tasksPath), { recursive: true });
  await fs.writeFile(
    tasksPath,
    `${JSON.stringify(
      {
        version: 1,
        updated_at: "2026-03-31T13:00:00.000Z",
        lanes: {
          bot_current: ["T3"],
          bot_queue: [],
        },
        tasks: {
          T3: {
            title: "Ready task",
            status: "pending",
            file: "memory/tasks/T3.md",
          },
        },
      },
      null,
      2,
    )}\n`,
    "utf-8",
  );
  return {
    workspaceDir,
    tasksPath,
  };
}

describe("task-plan", () => {
  it("saves a durable plan and mirrors its state onto the task card", async () => {
    const { workspaceDir, tasksPath } = await createWorkspaceTaskBoard();
    try {
      const saved = await saveTaskPlan({
        workspaceDir,
        taskId: "T3",
        plan: "# Plan\n- update runtime\n- run tests",
      });

      expect(saved).toMatchObject({
        taskId: "T3",
        exists: true,
        approvalState: "draft",
        changed: true,
        filePath: "memory/tasks/T3-plan.md",
      });
      expect(saved.plan).toContain("update runtime");

      const board = JSON.parse(await fs.readFile(tasksPath, "utf-8")) as {
        tasks: Record<string, Record<string, unknown>>;
      };
      expect(board.tasks.T3?.plan).toBe("memory/tasks/T3-plan.md");
      expect((board.tasks.T3?.plan_approval as { state?: string } | undefined)?.state).toBe(
        "draft",
      );

      const planFile = await fs.readFile(
        path.join(workspaceDir, "memory", "tasks", "T3-plan.md"),
        "utf-8",
      );
      expect(planFile).toContain("openclaw-task-plan");

      const loaded = await getTaskPlan({ workspaceDir, taskId: "T3" });
      expect(loaded).toMatchObject({
        exists: true,
        approvalState: "draft",
        filePath: "memory/tasks/T3-plan.md",
      });
    } finally {
      await fs.rm(workspaceDir, { recursive: true, force: true });
    }
  });

  it("keeps request_approval idempotent and resets to draft when the plan changes", async () => {
    const { workspaceDir, tasksPath } = await createWorkspaceTaskBoard();
    try {
      await saveTaskPlan({
        workspaceDir,
        taskId: "T3",
        plan: "# Plan\n- step one",
      });

      const requested = await requestTaskPlanApproval({
        workspaceDir,
        taskId: "T3",
      });
      expect(requested.approvalState).toBe("awaiting_approval");
      expect(requested.requestId).toBeTruthy();

      const requestedAgain = await requestTaskPlanApproval({
        workspaceDir,
        taskId: "T3",
      });
      expect(requestedAgain.changed).toBe(false);
      expect(requestedAgain.requestId).toBe(requested.requestId);

      const boardWhileAwaiting = JSON.parse(await fs.readFile(tasksPath, "utf-8")) as {
        tasks: Record<string, Record<string, unknown>>;
      };
      expect(boardWhileAwaiting.tasks.T3?.status).toBe("waiting_human");
      expect(boardWhileAwaiting.tasks.T3?.blockers).toEqual([
        "Plan approval required: memory/tasks/T3-plan.md",
      ]);

      const revised = await saveTaskPlan({
        workspaceDir,
        taskId: "T3",
        plan: "# Plan\n- step one\n- step two",
      });
      expect(revised).toMatchObject({
        approvalState: "draft",
        planWasEdited: true,
      });

      const boardAfterRevision = JSON.parse(await fs.readFile(tasksPath, "utf-8")) as {
        tasks: Record<string, Record<string, unknown>>;
      };
      expect(boardAfterRevision.tasks.T3?.status).toBe("pending");
      expect(boardAfterRevision.tasks.T3?.blockers).toBeUndefined();
    } finally {
      await fs.rm(workspaceDir, { recursive: true, force: true });
    }
  });

  it("persists approval and rejection decisions back into the task card", async () => {
    const { workspaceDir, tasksPath } = await createWorkspaceTaskBoard();
    try {
      await saveTaskPlan({
        workspaceDir,
        taskId: "T3",
        plan: "# Plan\n- implement\n- verify",
      });
      await requestTaskPlanApproval({
        workspaceDir,
        taskId: "T3",
      });

      const approved = await approveTaskPlan({
        workspaceDir,
        taskId: "T3",
        note: "Looks good.",
      });
      expect(approved).toMatchObject({
        approvalState: "approved",
        decisionNote: "Looks good.",
      });

      const boardAfterApproval = JSON.parse(await fs.readFile(tasksPath, "utf-8")) as {
        tasks: Record<string, Record<string, unknown>>;
      };
      expect(boardAfterApproval.tasks.T3?.status).toBe("pending");
      expect(boardAfterApproval.tasks.T3?.blockers).toBeUndefined();

      await requestTaskPlanApproval({
        workspaceDir,
        taskId: "T3",
      });
      const rejected = await rejectTaskPlan({
        workspaceDir,
        taskId: "T3",
        note: "Need a rollback section.",
      });
      expect(rejected).toMatchObject({
        approvalState: "rejected",
        decisionNote: "Need a rollback section.",
      });

      const boardAfterRejection = JSON.parse(await fs.readFile(tasksPath, "utf-8")) as {
        tasks: Record<string, Record<string, unknown>>;
      };
      expect(boardAfterRejection.tasks.T3?.status).toBe("blocked");
      expect(boardAfterRejection.tasks.T3?.blockers).toEqual([
        "Plan revision required: Need a rollback section.",
      ]);
    } finally {
      await fs.rm(workspaceDir, { recursive: true, force: true });
    }
  });
});
