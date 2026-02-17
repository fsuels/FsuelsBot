import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { promoteBotQueueTaskIfIdle } from "./task-board.js";

describe("promoteBotQueueTaskIfIdle", () => {
  it("promotes first bot_queue task into bot_current when idle", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-task-board-"));
    try {
      const tasksPath = path.join(tmpDir, "memory", "tasks.json");
      await fs.mkdir(path.dirname(tasksPath), { recursive: true });
      await fs.writeFile(
        tasksPath,
        JSON.stringify(
          {
            tasks: {
              T1: { title: "one", status: "pending" },
              T2: { title: "two", status: "pending" },
            },
            lanes: {
              bot_current: [],
              bot_queue: ["T1", "T2"],
            },
            updated_at: "2026-01-01T00:00:00.000Z",
          },
          null,
          2,
        ),
      );

      const result = await promoteBotQueueTaskIfIdle({
        workspaceDir: tmpDir,
        nowMs: new Date("2026-02-17T00:00:00.000Z").getTime(),
      });
      expect(result).toMatchObject({ status: "promoted", taskId: "T1" });

      const saved = JSON.parse(await fs.readFile(tasksPath, "utf-8")) as {
        lanes: { bot_current: string[]; bot_queue: string[] };
        tasks: Record<string, { status?: string; lane?: string; started_at?: string }>;
        updated_at: string;
      };
      expect(saved.lanes.bot_current).toEqual(["T1"]);
      expect(saved.lanes.bot_queue).toEqual(["T2"]);
      expect(saved.tasks.T1?.status).toBe("in_progress");
      expect(saved.tasks.T1?.lane).toBe("bot_current");
      expect(saved.tasks.T1?.started_at).toBe("2026-02-17T00:00:00.000Z");
      expect(saved.updated_at).toBe("2026-02-17T00:00:00.000Z");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("skips when bot_current already has a task", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-task-board-"));
    try {
      const tasksPath = path.join(tmpDir, "memory", "tasks.json");
      await fs.mkdir(path.dirname(tasksPath), { recursive: true });
      await fs.writeFile(
        tasksPath,
        JSON.stringify(
          {
            lanes: {
              bot_current: ["T1"],
              bot_queue: ["T2"],
            },
          },
          null,
          2,
        ),
      );

      const result = await promoteBotQueueTaskIfIdle({ workspaceDir: tmpDir });
      expect(result).toMatchObject({ status: "skipped", reason: "bot-current-not-empty" });
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("skips when task board is missing", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-task-board-"));
    try {
      const result = await promoteBotQueueTaskIfIdle({ workspaceDir: tmpDir });
      expect(result).toMatchObject({ status: "skipped", reason: "missing-file" });
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
