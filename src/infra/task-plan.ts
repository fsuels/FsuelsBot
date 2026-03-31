import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  bumpTaskBoardRevision,
  resolveTaskBoardRevision,
  withTaskBoardLock,
  type TaskBoard,
  type TaskBoardRevision,
  type TaskBoardTask,
} from "./task-board.js";

const PLAN_METADATA_PREFIX = "<!-- openclaw-task-plan:";
const PLAN_METADATA_SUFFIX = "-->";
const PLAN_METADATA_SCHEMA_VERSION = 1;
const DEFAULT_PLAN_DIR = path.join("memory", "tasks");
const PLAN_APPROVAL_BLOCKER_PREFIX = "Plan approval required:";
const PLAN_REVISION_BLOCKER_PREFIX = "Plan revision required:";
const TERMINAL_TASK_STATUSES = new Set([
  "archived",
  "canceled",
  "cancelled",
  "closed",
  "completed",
  "done",
]);

export const TASK_PLAN_MUTABLE_STATES = [
  "draft",
  "awaiting_approval",
  "approved",
  "rejected",
] as const;

export const TASK_PLAN_STATES = ["missing", ...TASK_PLAN_MUTABLE_STATES] as const;

export type MutableTaskPlanState = (typeof TASK_PLAN_MUTABLE_STATES)[number];
export type TaskPlanState = (typeof TASK_PLAN_STATES)[number];

type TaskPlanDocumentMeta = {
  schemaVersion: 1;
  taskId: string;
  approvalState: MutableTaskPlanState;
  requestId?: string;
  requestedAt?: string;
  decidedAt?: string;
  decisionNote?: string;
  previousStatus?: string;
  lastSavedHash?: string;
  lastSubmittedHash?: string;
  planWasEdited?: boolean;
};

type TaskPlanMirror = {
  state?: string;
  request_id?: string;
  requested_at?: string;
  decided_at?: string;
  decision_note?: string;
  previous_status?: string;
  last_saved_hash?: string;
  last_submitted_hash?: string;
  plan_was_edited?: boolean;
};

export type TaskPlanSnapshot = {
  taskId: string;
  filePath: string;
  absoluteFilePath: string;
  exists: boolean;
  plan: string;
  approvalState: TaskPlanState;
  planWasEdited: boolean;
  requestId?: string;
  requestedAt?: string;
  decidedAt?: string;
  decisionNote?: string;
  taskStatus?: string;
  boardRevision?: TaskBoardRevision;
  nextStep: string;
};

type TaskPlanMutationResult = TaskPlanSnapshot & {
  changed: boolean;
};

type ResolvedTaskPlanTarget = {
  board: TaskBoard;
  boardPath: string;
  boardRevision?: TaskBoardRevision;
  taskId: string;
  task: TaskBoardTask;
  filePath: string;
  absoluteFilePath: string;
};

export class TaskPlanError extends Error {
  code: "not_found" | "precondition_failed";

  constructor(code: "not_found" | "precondition_failed", message: string) {
    super(message);
    this.code = code;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeTaskId(value: unknown): string | undefined {
  return readString(value);
}

function normalizePlanText(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}

function hashPlan(plan: string): string {
  return createHash("sha256").update(normalizePlanText(plan)).digest("hex");
}

function createDefaultMeta(taskId: string): TaskPlanDocumentMeta {
  return {
    schemaVersion: PLAN_METADATA_SCHEMA_VERSION,
    taskId,
    approvalState: "draft",
    planWasEdited: false,
  };
}

function parseTaskPlanDocument(
  raw: string,
  taskId: string,
): {
  meta: TaskPlanDocumentMeta;
  plan: string;
} {
  const normalized = raw.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const firstLine = lines[0]?.trim() ?? "";
  const hasMetadata =
    firstLine.startsWith(PLAN_METADATA_PREFIX) && firstLine.endsWith(PLAN_METADATA_SUFFIX);
  let meta = createDefaultMeta(taskId);
  let plan = normalized;

  if (hasMetadata) {
    const jsonText = firstLine
      .slice(PLAN_METADATA_PREFIX.length, firstLine.length - PLAN_METADATA_SUFFIX.length)
      .trim();
    try {
      const parsed = JSON.parse(jsonText) as Record<string, unknown>;
      const approvalState = readString(parsed.approvalState);
      meta = {
        schemaVersion: PLAN_METADATA_SCHEMA_VERSION,
        taskId: readString(parsed.taskId) ?? taskId,
        approvalState:
          approvalState === "awaiting_approval" ||
          approvalState === "approved" ||
          approvalState === "rejected"
            ? approvalState
            : "draft",
        requestId: readString(parsed.requestId),
        requestedAt: readString(parsed.requestedAt),
        decidedAt: readString(parsed.decidedAt),
        decisionNote: readString(parsed.decisionNote),
        previousStatus: readString(parsed.previousStatus),
        lastSavedHash: readString(parsed.lastSavedHash),
        lastSubmittedHash: readString(parsed.lastSubmittedHash),
        planWasEdited: parsed.planWasEdited === true,
      };
    } catch {
      meta = createDefaultMeta(taskId);
    }
    plan = lines.slice(1).join("\n");
  }

  return {
    meta,
    plan: normalizePlanText(plan),
  };
}

function serializeTaskPlanDocument(meta: TaskPlanDocumentMeta, plan: string): string {
  return `${PLAN_METADATA_PREFIX} ${JSON.stringify(meta)} ${PLAN_METADATA_SUFFIX}\n\n${normalizePlanText(plan)}\n`;
}

function toMirror(meta: TaskPlanDocumentMeta): TaskPlanMirror {
  return {
    state: meta.approvalState,
    request_id: meta.requestId,
    requested_at: meta.requestedAt,
    decided_at: meta.decidedAt,
    decision_note: meta.decisionNote,
    previous_status: meta.previousStatus,
    last_saved_hash: meta.lastSavedHash,
    last_submitted_hash: meta.lastSubmittedHash,
    plan_was_edited: meta.planWasEdited === true,
  };
}

function pickTaskCardState(task: TaskBoardTask, taskId: string): { meta: TaskPlanDocumentMeta } {
  const rawMirror = asRecord(task.plan_approval);
  const state = readString(rawMirror?.state);
  return {
    meta: {
      schemaVersion: PLAN_METADATA_SCHEMA_VERSION,
      taskId,
      approvalState:
        state === "awaiting_approval" || state === "approved" || state === "rejected"
          ? state
          : "draft",
      requestId: readString(rawMirror?.request_id),
      requestedAt: readString(rawMirror?.requested_at),
      decidedAt: readString(rawMirror?.decided_at),
      decisionNote: readString(rawMirror?.decision_note),
      previousStatus: readString(rawMirror?.previous_status),
      lastSavedHash: readString(rawMirror?.last_saved_hash),
      lastSubmittedHash: readString(rawMirror?.last_submitted_hash),
      planWasEdited: rawMirror?.plan_was_edited === true,
    },
  };
}

function sanitizeTaskFileStem(taskId: string): string {
  const sanitized = taskId
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return sanitized || "task-plan";
}

function derivePlanRelativePath(taskId: string, task: TaskBoardTask): string {
  const configured = readString(task.plan);
  if (configured) {
    return configured;
  }
  const taskFile = readString(task.file);
  if (taskFile) {
    const ext = path.extname(taskFile);
    if (ext) {
      const stem = taskFile.slice(0, taskFile.length - ext.length);
      return `${stem}-plan${ext}`;
    }
    return `${taskFile}-plan.md`;
  }
  return path.join(DEFAULT_PLAN_DIR, `${sanitizeTaskFileStem(taskId)}-plan.md`);
}

function resolvePlanPaths(
  workspaceDir: string,
  relativePath: string,
): {
  filePath: string;
  absoluteFilePath: string;
} {
  const normalized = relativePath.replace(/\\/g, "/").trim();
  if (!normalized || normalized.startsWith("~") || path.isAbsolute(normalized)) {
    throw new TaskPlanError(
      "precondition_failed",
      `Task plan path must be workspace-relative, got "${relativePath}"`,
    );
  }
  const absolute = path.resolve(workspaceDir, normalized);
  const relative = path.relative(path.resolve(workspaceDir), absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new TaskPlanError(
      "precondition_failed",
      `Task plan path resolves outside the workspace: "${relativePath}"`,
    );
  }
  return {
    filePath: relative.replace(/\\/g, "/"),
    absoluteFilePath: absolute,
  };
}

async function readTaskBoard(boardPath: string): Promise<TaskBoard> {
  let raw: string;
  try {
    raw = await fs.readFile(boardPath, "utf-8");
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code)
        : undefined;
    if (code === "ENOENT") {
      throw new TaskPlanError(
        "precondition_failed",
        "Shared task board not found at memory/tasks.json.",
      );
    }
    throw error;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("invalid-shape");
    }
    return parsed as TaskBoard;
  } catch {
    throw new TaskPlanError("precondition_failed", "Shared task board is invalid JSON.");
  }
}

function resolveBoardTaskId(board: TaskBoard, taskId?: string): string {
  const normalized = normalizeTaskId(taskId);
  if (normalized) {
    return normalized;
  }
  const lanes = asRecord(board.lanes);
  const active = Array.isArray(lanes?.bot_current)
    ? normalizeTaskId(lanes?.bot_current[0])
    : undefined;
  if (active) {
    return active;
  }
  throw new TaskPlanError(
    "precondition_failed",
    "task_plan requires taskId or an active shared-board task in lanes.bot_current.",
  );
}

async function withResolvedTaskPlanTarget<T>(params: {
  workspaceDir: string;
  taskId?: string;
  fn: (target: ResolvedTaskPlanTarget) => Promise<T>;
}): Promise<T> {
  return withTaskBoardLock({
    workspaceDir: params.workspaceDir,
    fn: async (boardPath) => {
      const board = await readTaskBoard(boardPath);
      const resolvedTaskId = resolveBoardTaskId(board, params.taskId);
      const task = asRecord(asRecord(board.tasks)?.[resolvedTaskId]);
      if (!task) {
        throw new TaskPlanError(
          "not_found",
          `Task ${resolvedTaskId} was not found in memory/tasks.json.`,
        );
      }
      const { filePath, absoluteFilePath } = resolvePlanPaths(
        params.workspaceDir,
        derivePlanRelativePath(resolvedTaskId, task),
      );
      return params.fn({
        board,
        boardPath,
        boardRevision: resolveTaskBoardRevision(board),
        taskId: resolvedTaskId,
        task,
        filePath,
        absoluteFilePath,
      });
    },
  });
}

async function readPersistedTaskPlan(target: ResolvedTaskPlanTarget): Promise<TaskPlanSnapshot> {
  const fallback = pickTaskCardState(target.task, target.taskId);
  try {
    const raw = await fs.readFile(target.absoluteFilePath, "utf-8");
    const parsed = parseTaskPlanDocument(raw, target.taskId);
    const planHash = parsed.meta.lastSavedHash ?? hashPlan(parsed.plan);
    const meta: TaskPlanDocumentMeta = {
      ...parsed.meta,
      taskId: target.taskId,
      lastSavedHash: planHash,
      planWasEdited:
        parsed.meta.planWasEdited === true ||
        Boolean(parsed.meta.lastSubmittedHash && parsed.meta.lastSubmittedHash !== planHash),
    };
    return buildTaskPlanSnapshot({
      taskId: target.taskId,
      filePath: target.filePath,
      absoluteFilePath: target.absoluteFilePath,
      exists: true,
      plan: parsed.plan,
      meta,
      boardRevision: target.boardRevision,
      taskStatus: readString(target.task.status),
    });
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code)
        : undefined;
    if (code !== "ENOENT") {
      throw error;
    }
  }

  return buildTaskPlanSnapshot({
    taskId: target.taskId,
    filePath: target.filePath,
    absoluteFilePath: target.absoluteFilePath,
    exists: false,
    plan: "",
    meta: fallback.meta,
    boardRevision: target.boardRevision,
    taskStatus: readString(target.task.status),
  });
}

function getNextStep(state: TaskPlanState): string {
  switch (state) {
    case "missing":
      return "Write a complete implementation plan before requesting approval.";
    case "draft":
      return "Review the implementation plan, then request approval when it is ready.";
    case "awaiting_approval":
      return "Wait for human approval before executing the implementation plan.";
    case "approved":
      return "Execute the approved implementation plan.";
    case "rejected":
      return "Revise the implementation plan to address feedback, then resubmit it.";
  }
}

function buildTaskPlanSnapshot(params: {
  taskId: string;
  filePath: string;
  absoluteFilePath: string;
  exists: boolean;
  plan: string;
  meta: TaskPlanDocumentMeta;
  boardRevision?: TaskBoardRevision;
  taskStatus?: string;
}): TaskPlanSnapshot {
  const approvalState: TaskPlanState = params.exists ? params.meta.approvalState : "missing";
  const planWasEdited =
    params.meta.planWasEdited === true ||
    Boolean(
      params.meta.lastSubmittedHash &&
      params.meta.lastSavedHash &&
      params.meta.lastSubmittedHash !== params.meta.lastSavedHash,
    );
  return {
    taskId: params.taskId,
    filePath: params.filePath,
    absoluteFilePath: params.absoluteFilePath,
    exists: params.exists,
    plan: params.plan,
    approvalState,
    planWasEdited,
    requestId: params.meta.requestId,
    requestedAt: params.meta.requestedAt,
    decidedAt: params.meta.decidedAt,
    decisionNote: params.meta.decisionNote,
    taskStatus: params.taskStatus,
    boardRevision: params.boardRevision,
    nextStep: getNextStep(approvalState),
  };
}

function defaultRestoredStatus(previousStatus: string | undefined): string {
  const normalized = previousStatus?.trim().toLowerCase();
  if (!normalized || normalized === "waiting_human") {
    return "pending";
  }
  return previousStatus?.trim() || "pending";
}

function normalizeTaskBlockers(task: TaskBoardTask): string[] {
  if (!Array.isArray(task.blockers)) {
    return [];
  }
  return task.blockers
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function removePlanSpecificBlockers(task: TaskBoardTask): string[] {
  return normalizeTaskBlockers(task).filter((entry) => {
    const lower = entry.toLowerCase();
    return (
      !lower.startsWith(PLAN_APPROVAL_BLOCKER_PREFIX.toLowerCase()) &&
      !lower.startsWith(PLAN_REVISION_BLOCKER_PREFIX.toLowerCase())
    );
  });
}

function replaceTaskBlockers(task: TaskBoardTask, blockers: string[]): void {
  if (blockers.length === 0) {
    delete task.blockers;
    return;
  }
  task.blockers = blockers;
}

function updateTaskStatus(task: TaskBoardTask, status: string): void {
  task.status = status;
}

function mirrorPlanStateToTaskCard(
  task: TaskBoardTask,
  filePath: string,
  meta: TaskPlanDocumentMeta,
  mode: "draft" | "awaiting_approval" | "approved" | "rejected",
): void {
  task.plan = filePath;
  task.plan_approval = toMirror(meta);
  const blockers = removePlanSpecificBlockers(task);

  if (mode === "awaiting_approval") {
    blockers.push(`${PLAN_APPROVAL_BLOCKER_PREFIX} ${filePath}`);
    updateTaskStatus(task, "waiting_human");
  } else if (mode === "rejected") {
    blockers.push(
      `${PLAN_REVISION_BLOCKER_PREFIX} ${meta.decisionNote || `revise ${filePath} and resubmit`}`,
    );
    updateTaskStatus(task, "blocked");
  } else {
    replaceTaskBlockers(task, blockers);
    const normalizedStatus = readString(task.status)?.toLowerCase();
    if (normalizedStatus === "waiting_human" || normalizedStatus === "blocked") {
      updateTaskStatus(task, defaultRestoredStatus(meta.previousStatus));
    }
  }

  if (mode === "awaiting_approval" || mode === "rejected") {
    replaceTaskBlockers(task, blockers);
  }
}

function ensureTaskCanRequestApproval(task: TaskBoardTask, taskId: string): void {
  const normalizedStatus = readString(task.status)?.toLowerCase();
  if (normalizedStatus && TERMINAL_TASK_STATUSES.has(normalizedStatus)) {
    throw new TaskPlanError(
      "precondition_failed",
      `Task ${taskId} is already ${normalizedStatus}; plan approval is no longer relevant.`,
    );
  }
}

async function atomicWriteText(filePath: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmpPath, text, "utf-8");
  await fs.rename(tmpPath, filePath);
}

async function writeTaskBoard(boardPath: string, board: TaskBoard): Promise<TaskBoardRevision> {
  const nowMs = Date.now();
  const revision = bumpTaskBoardRevision(board, nowMs);
  const tmpPath = `${boardPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmpPath, `${JSON.stringify(board, null, 2)}\n`, "utf-8");
  await fs.rename(tmpPath, boardPath);
  return revision;
}

export async function getTaskPlan(params: {
  workspaceDir: string;
  taskId?: string;
}): Promise<TaskPlanSnapshot> {
  return withResolvedTaskPlanTarget({
    workspaceDir: params.workspaceDir,
    taskId: params.taskId,
    fn: async (target) => readPersistedTaskPlan(target),
  });
}

export async function saveTaskPlan(params: {
  workspaceDir: string;
  taskId?: string;
  plan: string;
}): Promise<TaskPlanMutationResult> {
  const nextPlan = normalizePlanText(params.plan);
  if (!nextPlan) {
    throw new TaskPlanError("precondition_failed", "plan required");
  }

  return withResolvedTaskPlanTarget({
    workspaceDir: params.workspaceDir,
    taskId: params.taskId,
    fn: async (target) => {
      const current = await readPersistedTaskPlan(target);
      const currentHash = current.exists ? hashPlan(current.plan) : undefined;
      const nextHash = hashPlan(nextPlan);
      const changed = currentHash !== nextHash || target.task.plan !== target.filePath;
      if (!changed && current.exists) {
        return { ...current, changed: false };
      }

      const nextMeta = current.exists
        ? parseTaskPlanDocument(await fs.readFile(target.absoluteFilePath, "utf-8"), target.taskId)
            .meta
        : createDefaultMeta(target.taskId);
      nextMeta.taskId = target.taskId;
      nextMeta.lastSavedHash = nextHash;

      if (nextMeta.approvalState !== "draft" && currentHash !== nextHash) {
        nextMeta.approvalState = "draft";
        nextMeta.requestId = undefined;
        nextMeta.requestedAt = undefined;
        nextMeta.decidedAt = undefined;
        nextMeta.decisionNote = undefined;
        nextMeta.planWasEdited = true;
        nextMeta.lastSubmittedHash = undefined;
      } else if (!nextMeta.requestId) {
        nextMeta.approvalState = "draft";
        nextMeta.planWasEdited = false;
      }

      await atomicWriteText(target.absoluteFilePath, serializeTaskPlanDocument(nextMeta, nextPlan));
      mirrorPlanStateToTaskCard(target.task, target.filePath, nextMeta, nextMeta.approvalState);
      target.task.updated_at = new Date().toISOString();
      const revision = await writeTaskBoard(target.boardPath, target.board);
      return {
        ...buildTaskPlanSnapshot({
          taskId: target.taskId,
          filePath: target.filePath,
          absoluteFilePath: target.absoluteFilePath,
          exists: true,
          plan: nextPlan,
          meta: nextMeta,
          boardRevision: revision,
          taskStatus: readString(target.task.status),
        }),
        changed: true,
      };
    },
  });
}

export async function requestTaskPlanApproval(params: {
  workspaceDir: string;
  taskId?: string;
  plan?: string;
}): Promise<TaskPlanMutationResult> {
  if (typeof params.plan === "string" && params.plan.trim()) {
    await saveTaskPlan({
      workspaceDir: params.workspaceDir,
      taskId: params.taskId,
      plan: params.plan,
    });
  }

  return withResolvedTaskPlanTarget({
    workspaceDir: params.workspaceDir,
    taskId: params.taskId,
    fn: async (target) => {
      ensureTaskCanRequestApproval(target.task, target.taskId);
      const current = await readPersistedTaskPlan(target);
      if (!current.exists || !current.plan.trim()) {
        throw new TaskPlanError(
          "precondition_failed",
          `No persisted task plan found for ${target.taskId}. Save the plan first or pass plan with request_approval.`,
        );
      }

      const existingMeta = parseTaskPlanDocument(
        await fs.readFile(target.absoluteFilePath, "utf-8"),
        target.taskId,
      ).meta;
      const currentHash = hashPlan(current.plan);
      const alreadyAwaiting =
        existingMeta.approvalState === "awaiting_approval" &&
        existingMeta.requestId &&
        existingMeta.lastSubmittedHash === currentHash &&
        existingMeta.planWasEdited !== true;

      if (alreadyAwaiting) {
        mirrorPlanStateToTaskCard(target.task, target.filePath, existingMeta, "awaiting_approval");
        return {
          ...buildTaskPlanSnapshot({
            taskId: target.taskId,
            filePath: target.filePath,
            absoluteFilePath: target.absoluteFilePath,
            exists: true,
            plan: current.plan,
            meta: existingMeta,
            boardRevision: target.boardRevision,
            taskStatus: readString(target.task.status),
          }),
          changed: false,
        };
      }

      const nextMeta: TaskPlanDocumentMeta = {
        ...existingMeta,
        taskId: target.taskId,
        approvalState: "awaiting_approval",
        requestId: randomUUID(),
        requestedAt: new Date().toISOString(),
        decidedAt: undefined,
        decisionNote: undefined,
        previousStatus:
          readString(target.task.status) &&
          readString(target.task.status)?.toLowerCase() !== "waiting_human"
            ? readString(target.task.status)
            : existingMeta.previousStatus,
        lastSavedHash: currentHash,
        lastSubmittedHash: currentHash,
        planWasEdited: false,
      };

      await atomicWriteText(
        target.absoluteFilePath,
        serializeTaskPlanDocument(nextMeta, current.plan),
      );
      mirrorPlanStateToTaskCard(target.task, target.filePath, nextMeta, "awaiting_approval");
      target.task.updated_at = new Date().toISOString();
      const revision = await writeTaskBoard(target.boardPath, target.board);
      return {
        ...buildTaskPlanSnapshot({
          taskId: target.taskId,
          filePath: target.filePath,
          absoluteFilePath: target.absoluteFilePath,
          exists: true,
          plan: current.plan,
          meta: nextMeta,
          boardRevision: revision,
          taskStatus: readString(target.task.status),
        }),
        changed: true,
      };
    },
  });
}

export async function approveTaskPlan(params: {
  workspaceDir: string;
  taskId?: string;
  note?: string;
}): Promise<TaskPlanMutationResult> {
  return withResolvedTaskPlanTarget({
    workspaceDir: params.workspaceDir,
    taskId: params.taskId,
    fn: async (target) => {
      const current = await readPersistedTaskPlan(target);
      if (!current.exists || !current.plan.trim()) {
        throw new TaskPlanError(
          "precondition_failed",
          `No persisted task plan found for ${target.taskId}.`,
        );
      }

      const nextMeta = parseTaskPlanDocument(
        await fs.readFile(target.absoluteFilePath, "utf-8"),
        target.taskId,
      ).meta;
      nextMeta.taskId = target.taskId;
      nextMeta.approvalState = "approved";
      nextMeta.decidedAt = new Date().toISOString();
      nextMeta.decisionNote = readString(params.note);
      nextMeta.planWasEdited = false;
      nextMeta.lastSavedHash = nextMeta.lastSavedHash ?? hashPlan(current.plan);
      nextMeta.lastSubmittedHash = nextMeta.lastSubmittedHash ?? nextMeta.lastSavedHash;

      await atomicWriteText(
        target.absoluteFilePath,
        serializeTaskPlanDocument(nextMeta, current.plan),
      );
      mirrorPlanStateToTaskCard(target.task, target.filePath, nextMeta, "approved");
      target.task.updated_at = new Date().toISOString();
      const revision = await writeTaskBoard(target.boardPath, target.board);
      return {
        ...buildTaskPlanSnapshot({
          taskId: target.taskId,
          filePath: target.filePath,
          absoluteFilePath: target.absoluteFilePath,
          exists: true,
          plan: current.plan,
          meta: nextMeta,
          boardRevision: revision,
          taskStatus: readString(target.task.status),
        }),
        changed: true,
      };
    },
  });
}

export async function rejectTaskPlan(params: {
  workspaceDir: string;
  taskId?: string;
  note?: string;
}): Promise<TaskPlanMutationResult> {
  return withResolvedTaskPlanTarget({
    workspaceDir: params.workspaceDir,
    taskId: params.taskId,
    fn: async (target) => {
      const current = await readPersistedTaskPlan(target);
      if (!current.exists || !current.plan.trim()) {
        throw new TaskPlanError(
          "precondition_failed",
          `No persisted task plan found for ${target.taskId}.`,
        );
      }

      const nextMeta = parseTaskPlanDocument(
        await fs.readFile(target.absoluteFilePath, "utf-8"),
        target.taskId,
      ).meta;
      nextMeta.taskId = target.taskId;
      nextMeta.approvalState = "rejected";
      nextMeta.decidedAt = new Date().toISOString();
      nextMeta.decisionNote = readString(params.note) ?? `revise ${target.filePath} and resubmit`;
      nextMeta.planWasEdited = false;
      nextMeta.lastSavedHash = nextMeta.lastSavedHash ?? hashPlan(current.plan);
      nextMeta.lastSubmittedHash = nextMeta.lastSubmittedHash ?? nextMeta.lastSavedHash;

      await atomicWriteText(
        target.absoluteFilePath,
        serializeTaskPlanDocument(nextMeta, current.plan),
      );
      mirrorPlanStateToTaskCard(target.task, target.filePath, nextMeta, "rejected");
      target.task.updated_at = new Date().toISOString();
      const revision = await writeTaskBoard(target.boardPath, target.board);
      return {
        ...buildTaskPlanSnapshot({
          taskId: target.taskId,
          filePath: target.filePath,
          absoluteFilePath: target.absoluteFilePath,
          exists: true,
          plan: current.plan,
          meta: nextMeta,
          boardRevision: revision,
          taskStatus: readString(target.task.status),
        }),
        changed: true,
      };
    },
  });
}
