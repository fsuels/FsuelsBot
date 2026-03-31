import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import "./test-helpers/fast-core-tools.js";
import { createOpenClawTools } from "./openclaw-tools.js";

function buildTasksPayload() {
  return {
    version: 3,
    updated_at: "2026-03-31T13:00:00.000Z",
    lanes: {
      bot_current: ["T2"],
      bot_queue: ["T10", "T3"],
      human: ["T20"],
      done_today: ["T1"],
    },
    tasks: {
      T1: {
        title: "Done task",
        status: "done",
      },
      T2: {
        title: "Active task",
        status: "in_progress",
        lane: "bot_queue",
        summary: "Already running.",
      },
      T3: {
        title: "Ready task",
        status: "pending",
        file: "memory/tasks/T3.md",
        plan: "memory/tasks/T3-plan.md",
        steps: [{ id: "s1", text: "Check it", status: "todo", checked: false }],
      },
      T10: {
        title: "Blocked task",
        status: "pending",
        blocked_by: ["T1", "T3"],
      },
      T20: {
        title: "Needs human",
        status: "waiting_human",
        blocker: "Need approval.",
      },
    },
  };
}

describe("task board tools", () => {
  it("tasks_list returns normalized task-board details", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-task-tools-"));
    try {
      const tasksPath = path.join(tmpDir, "memory", "tasks.json");
      await fs.mkdir(path.dirname(tasksPath), { recursive: true });
      await fs.writeFile(tasksPath, `${JSON.stringify(buildTasksPayload(), null, 2)}\n`, "utf-8");

      const tool = createOpenClawTools({ workspaceDir: tmpDir }).find(
        (candidate) => candidate.name === "tasks_list",
      );
      expect(tool).toBeDefined();
      if (!tool) {
        throw new Error("missing tasks_list tool");
      }
      expect(tool.isReadOnly?.()).toBe(true);
      expect(tool.isConcurrencySafe?.()).toBe(true);
      expect(tool.userFacingName?.()).toBe("Task Board");

      const result = await tool.execute("call-1", {});
      const details = result.details as {
        summary: { available: number; blocked: number };
        tasks: Array<{ id: string; lane?: string; blockedBy?: string[] }>;
      };

      expect(details.summary).toMatchObject({
        available: 1,
        blocked: 2,
      });
      expect(details.tasks.map((task) => task.id)).toEqual(["T1", "T2", "T3", "T10", "T20"]);
      expect(details.tasks.find((task) => task.id === "T2")?.lane).toBe("bot_current");
      expect(details.tasks.find((task) => task.id === "T10")?.blockedBy).toEqual(["T3"]);
      expect(result.content[0]?.text).toContain("Ready now (lowest-ID first):");
      expect(result.content[0]?.text).toContain("Use task_get with a task id");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("task_get returns normalized task detail and helpful not-found results", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-task-tools-"));
    try {
      const tasksPath = path.join(tmpDir, "memory", "tasks.json");
      await fs.mkdir(path.dirname(tasksPath), { recursive: true });
      await fs.writeFile(tasksPath, `${JSON.stringify(buildTasksPayload(), null, 2)}\n`, "utf-8");

      const tool = createOpenClawTools({ workspaceDir: tmpDir }).find(
        (candidate) => candidate.name === "task_get",
      );
      expect(tool).toBeDefined();
      if (!tool) {
        throw new Error("missing task_get tool");
      }
      expect(tool.isReadOnly?.()).toBe(true);
      expect(tool.isConcurrencySafe?.()).toBe(true);
      expect(tool.userFacingName?.()).toBe("Task Detail");

      const detailResult = await tool.execute("call-2", { taskId: "T3" });
      expect(detailResult.details).toMatchObject({
        id: "T3",
        title: "Ready task",
        isAvailableToClaim: true,
        file: "memory/tasks/T3.md",
        plan: "memory/tasks/T3-plan.md",
      });
      expect(detailResult.content[0]?.text).toContain("Task T3: Ready task");
      expect(detailResult.content[0]?.text).toContain("Ready: yes (ready)");

      const missingResult = await tool.execute("call-3", { taskId: "missing" });
      expect(missingResult.details).toMatchObject({
        ok: false,
        success: false,
        found: false,
        code: "not_found",
        taskId: "missing",
      });
      expect(missingResult.content[0]?.text).toContain("Known task ids: T1, T2, T3, T10, T20");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
