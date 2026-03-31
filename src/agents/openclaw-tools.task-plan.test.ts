import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import "./test-helpers/fast-core-tools.js";
import { createOpenClawTools } from "./openclaw-tools.js";

async function createWorkspaceTaskBoard() {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-task-plan-tool-"));
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
  };
}

describe("task_plan tool", () => {
  it("returns a deliberate missing-plan state before any plan exists", async () => {
    const { workspaceDir } = await createWorkspaceTaskBoard();
    try {
      const tool = createOpenClawTools({ workspaceDir }).find(
        (candidate) => candidate.name === "task_plan",
      );
      expect(tool).toBeDefined();
      if (!tool) {
        throw new Error("missing task_plan tool");
      }

      const result = await tool.execute("task-plan-get", {
        action: "get",
        taskId: "T3",
      });
      expect(result.details).toMatchObject({
        action: "get",
        taskId: "T3",
        exists: false,
        approvalState: "missing",
        changed: false,
      });
      expect(result.content[0]?.text).toContain("State: missing");
    } finally {
      await fs.rm(workspaceDir, { recursive: true, force: true });
    }
  });

  it("saves and submits a task plan with canonical machine-visible output", async () => {
    const { workspaceDir } = await createWorkspaceTaskBoard();
    try {
      const tool = createOpenClawTools({ workspaceDir }).find(
        (candidate) => candidate.name === "task_plan",
      );
      if (!tool) {
        throw new Error("missing task_plan tool");
      }

      const saved = await tool.execute("task-plan-save", {
        action: "save",
        taskId: "T3",
        plan: "# Plan\n- patch code\n- run tests",
      });
      expect(saved.details).toMatchObject({
        action: "save",
        taskId: "T3",
        exists: true,
        approvalState: "draft",
        changed: true,
      });

      const requested = await tool.execute("task-plan-request", {
        action: "request_approval",
        taskId: "T3",
      });
      expect(requested.details).toMatchObject({
        action: "request_approval",
        taskId: "T3",
        exists: true,
        approvalState: "awaiting_approval",
        changed: true,
      });
      expect((requested.details as { requestId?: string }).requestId).toBeTruthy();
      expect((requested.details as { nextStep?: string }).nextStep).toContain(
        "Wait for human approval",
      );
    } finally {
      await fs.rm(workspaceDir, { recursive: true, force: true });
    }
  });
});
