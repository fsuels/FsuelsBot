import fs from "node:fs/promises";
import path from "node:path";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("gateway/task-board");
const TASK_BOARD_RELATIVE_PATH = path.join("memory", "tasks.json");

type TaskBoardTask = Record<string, unknown>;
type TaskBoard = {
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

export async function promoteBotQueueTaskIfIdle(params: {
  workspaceDir: string;
  nowMs?: number;
}): Promise<BotQueuePromotionResult> {
  const boardPath = path.join(params.workspaceDir, TASK_BOARD_RELATIVE_PATH);
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
  const tasks = isTaskBoard(parsed.tasks) ? (parsed.tasks as Record<string, TaskBoardTask>) : null;
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

  parsed.updated_at = resolveUpdatedAtValue(parsed.updated_at, nowMs);

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
}
