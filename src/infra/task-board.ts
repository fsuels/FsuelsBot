import fs from "node:fs/promises";
import path from "node:path";
import lockfile from "proper-lockfile";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("gateway/task-board");
export const TASK_BOARD_RELATIVE_PATH = path.join("memory", "tasks.json");
const TASK_BOARD_LOCK_OPTIONS = {
  retries: {
    retries: 10,
    factor: 2,
    minTimeout: 50,
    maxTimeout: 2_000,
    randomize: true,
  },
  stale: 30_000,
} as const;

export type TaskBoardRevision = string | number;
export type TaskBoardTask = Record<string, unknown>;
export type TaskBoard = {
  version?: unknown;
  tasks?: Record<string, TaskBoardTask>;
  lanes?: Record<string, unknown>;
  updated_at?: unknown;
} & Record<string, unknown>;

export type BotQueuePromotionResult =
  | {
      status: "promoted";
      taskId: string;
      path: string;
    }
  | {
      status: "skipped";
      reason: "missing-file" | "bot-current-not-empty" | "bot-queue-empty";
      path: string;
    }
  | {
      status: "invalid";
      reason: "invalid-json" | "invalid-shape";
      path: string;
    }
  | {
      status: "error";
      reason: string;
      path: string;
    };

function normalizeLaneIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }
    const taskId = item.trim();
    if (!taskId || seen.has(taskId)) {
      continue;
    }
    seen.add(taskId);
    out.push(taskId);
  }
  return out;
}

function resolveUpdatedAtValue(previous: unknown, nowMs: number): string | number {
  if (typeof previous === "number" && Number.isFinite(previous)) {
    return nowMs;
  }
  return new Date(nowMs).toISOString();
}

function isTaskBoard(value: unknown): value is TaskBoard {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function resolveTaskBoardPath(workspaceDir: string): string {
  return path.join(workspaceDir, TASK_BOARD_RELATIVE_PATH);
}

export function resolveTaskBoardRevision(board: TaskBoard): TaskBoardRevision | undefined {
  if (typeof board.version === "number" && Number.isFinite(board.version)) {
    return Math.floor(board.version);
  }
  if (typeof board.updated_at === "number" && Number.isFinite(board.updated_at)) {
    return Math.floor(board.updated_at);
  }
  if (typeof board.updated_at === "string") {
    const trimmed = board.updated_at.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return undefined;
}

export function bumpTaskBoardRevision(board: TaskBoard, nowMs: number): TaskBoardRevision {
  const currentVersion =
    typeof board.version === "number" && Number.isFinite(board.version)
      ? Math.max(0, Math.floor(board.version))
      : 0;
  const nextVersion = currentVersion + 1;
  board.version = nextVersion;
  board.updated_at = resolveUpdatedAtValue(board.updated_at, nowMs);
  return nextVersion;
}

export async function withTaskBoardLock<T>(params: {
  workspaceDir: string;
  fn: (boardPath: string) => Promise<T>;
}): Promise<T> {
  const boardPath = resolveTaskBoardPath(params.workspaceDir);
  let release: (() => Promise<void>) | undefined;
  try {
    await fs.access(boardPath);
    release = await lockfile.lock(boardPath, TASK_BOARD_LOCK_OPTIONS);
    return await params.fn(boardPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return await params.fn(boardPath);
    }
    throw error;
  } finally {
    if (release) {
      try {
        await release();
      } catch {
        // Ignore unlock failures for best-effort cleanup.
      }
    }
  }
}

export async function promoteBotQueueTaskIfIdle(params: {
  workspaceDir: string;
  nowMs?: number;
}): Promise<BotQueuePromotionResult> {
  return withTaskBoardLock({
    workspaceDir: params.workspaceDir,
    fn: async (boardPath) => {
      let raw: string;
      try {
        raw = await fs.readFile(boardPath, "utf-8");
      } catch (err) {
        const code =
          err && typeof err === "object" && "code" in err
            ? String((err as { code?: unknown }).code)
            : undefined;
        if (code === "ENOENT") {
          return { status: "skipped", reason: "missing-file", path: boardPath };
        }
        return { status: "error", reason: String(err), path: boardPath };
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw) as unknown;
      } catch {
        return { status: "invalid", reason: "invalid-json", path: boardPath };
      }
      if (!isTaskBoard(parsed)) {
        return { status: "invalid", reason: "invalid-shape", path: boardPath };
      }

      const lanes = isTaskBoard(parsed.lanes) ? parsed.lanes : undefined;
      if (!lanes) {
        return { status: "invalid", reason: "invalid-shape", path: boardPath };
      }

      const botCurrent = normalizeLaneIds(lanes.bot_current);
      if (botCurrent.length > 0) {
        return { status: "skipped", reason: "bot-current-not-empty", path: boardPath };
      }

      const botQueue = normalizeLaneIds(lanes.bot_queue);
      if (botQueue.length === 0) {
        return { status: "skipped", reason: "bot-queue-empty", path: boardPath };
      }

      const nextTaskId = botQueue[0] as string;
      lanes.bot_current = [nextTaskId];
      lanes.bot_queue = botQueue.slice(1);

      const nowMs = params.nowMs ?? Date.now();
      const nowIso = new Date(nowMs).toISOString();
      const tasks = isTaskBoard(parsed.tasks)
        ? (parsed.tasks as Record<string, TaskBoardTask>)
        : null;
      const nextTask = tasks?.[nextTaskId];
      if (nextTask && typeof nextTask === "object" && !Array.isArray(nextTask)) {
        const rawStatus =
          typeof nextTask.status === "string" ? nextTask.status.trim().toLowerCase() : "";
        if (!["done", "completed", "cancelled", "canceled"].includes(rawStatus)) {
          nextTask.status = "in_progress";
        }
        nextTask.lane = "bot_current";
        nextTask.updated_at = nowIso;
        if (nextTask.started_at === undefined) {
          nextTask.started_at = nowIso;
        }
      }

      bumpTaskBoardRevision(parsed, nowMs);

      const tmpPath = `${boardPath}.${process.pid}.${Date.now()}.tmp`;
      try {
        await fs.mkdir(path.dirname(boardPath), { recursive: true });
        await fs.writeFile(tmpPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf-8");
        await fs.rename(tmpPath, boardPath);
      } catch (err) {
        try {
          await fs.rm(tmpPath, { force: true });
        } catch {
          // best-effort cleanup
        }
        return { status: "error", reason: String(err), path: boardPath };
      }

      log.info("promoted bot_queue task into bot_current", { taskId: nextTaskId, path: boardPath });
      return { status: "promoted", taskId: nextTaskId, path: boardPath };
    },
  });
}
