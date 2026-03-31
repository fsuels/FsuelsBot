import fs from "node:fs/promises";
import path from "node:path";

const TASK_BOARD_RELATIVE_PATH = path.join("memory", "tasks.json");

const ACTIVE_STATUSES = new Set(["active", "in_progress"]);
const BLOCKED_STATUSES = new Set(["blocked"]);
const COMPLETED_STATUSES = new Set(["canceled", "cancelled", "complete", "completed", "done"]);
const HIDDEN_STATUSES = new Set(["archived", "trash", "trashed"]);
const HUMAN_STATUSES = new Set(["waiting_human"]);
const HUMAN_LANES = new Set(["human"]);
const HIDDEN_LANES = new Set(["trash"]);
const PAUSED_LANES = new Set(["paused"]);
const ACTIVE_LANES = new Set(["bot_current"]);
const COMPLETED_LANES = new Set(["done_today"]);

export type RawTaskBoardTask = Record<string, unknown> & {
  title?: string;
  summary?: string;
  goal?: string;
  status?: string;
  lane?: string;
  blockers?: unknown;
  blocker?: unknown;
  blocked_by?: unknown;
  blockedBy?: unknown;
  dependencies?: unknown;
  depends_on?: unknown;
  owner?: unknown;
  claimed_by?: unknown;
  file?: unknown;
  plan?: unknown;
  kind?: unknown;
  next_action?: unknown;
  progress?: unknown;
  steps?: unknown;
  current_step?: unknown;
  context?: unknown;
  links?: unknown;
  handoff?: unknown;
  private?: unknown;
  internal?: unknown;
  visibility?: unknown;
};

export type RawTaskBoard = {
  version?: unknown;
  updated_at?: unknown;
  tasks?: Record<string, RawTaskBoardTask>;
  lanes?: Record<string, unknown>;
} & Record<string, unknown>;

export type TaskBoardSummary = {
  total: number;
  pending: number;
  in_progress: number;
  completed: number;
  blocked: number;
  available: number;
};

export type NormalizedTaskStatus = "pending" | "in_progress" | "completed" | "blocked";

export type NormalizedTaskSummary = {
  id: string;
  title: string;
  subject: string;
  status: NormalizedTaskStatus;
  rawStatus?: string;
  lane?: string;
  rawLane?: string;
  owner?: string;
  hasOwner: boolean;
  blockedBy: string[];
  blockers: string[];
  isBlocked: boolean;
  isAvailableToClaim: boolean;
  isReady: boolean;
  readyReason:
    | "ready"
    | "blocked"
    | "blocked_by_tasks"
    | "blocked_by_note"
    | "claimed"
    | "completed"
    | "in_progress"
    | "needs_human"
    | "paused"
    | "pending";
  needsHuman: boolean;
  isPaused: boolean;
  file?: string;
  plan?: string;
  kind?: string;
  summary?: string;
  goal?: string;
  nextAction?: string;
  next_action?: string;
  progress?: string;
  stepCount?: number;
  stepsDone?: number;
};

export type NormalizedTaskDetail = NormalizedTaskSummary & {
  createdAt?: string;
  updatedAt?: string;
  startedAt?: string;
  currentStep?: number;
  current_step?: number;
  steps?: Array<{
    id?: string;
    text?: string;
    status?: string;
    checked?: boolean;
  }>;
  context?: Record<string, unknown>;
  links?: unknown[];
  handoff?: Record<string, unknown>;
};

export type TaskBoardSnapshot = {
  version?: number;
  updatedAt?: string;
  summary: TaskBoardSummary;
  tasks: NormalizedTaskSummary[];
  lanes: Record<string, string[]>;
};

type LoadTaskBoardSnapshotResult = {
  boardPath: string;
  board: RawTaskBoard;
  snapshot: TaskBoardSnapshot;
};

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

function humanizeTaskId(taskId: string): string {
  return taskId.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeTaskIdList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const taskId = readString(item);
    if (!taskId || seen.has(taskId)) {
      continue;
    }
    seen.add(taskId);
    out.push(taskId);
  }
  return out;
}

function compareTaskIds(a: string, b: string): number {
  const numericAware = a.localeCompare(b, undefined, {
    numeric: true,
    sensitivity: "base",
  });
  if (numericAware !== 0) {
    return numericAware;
  }
  return a.localeCompare(b);
}

function resolveLaneMap(board: RawTaskBoard): Map<string, string> {
  const laneMap = new Map<string, string>();
  const lanes = asRecord(board.lanes) ?? {};
  for (const [laneName, rawIds] of Object.entries(lanes)) {
    const ids = normalizeTaskIdList(rawIds);
    for (const taskId of ids) {
      if (!laneMap.has(taskId)) {
        laneMap.set(taskId, laneName);
      }
    }
  }
  return laneMap;
}

function resolveCanonicalLane(
  taskId: string,
  task: RawTaskBoardTask,
  laneMap: Map<string, string>,
) {
  return laneMap.get(taskId) ?? readString(task.lane);
}

function resolvePrimaryTitle(taskId: string, task: RawTaskBoardTask): string {
  return (
    readString(task.title) ??
    readString(task.summary) ??
    readString(task.goal) ??
    readString(task.next_action) ??
    humanizeTaskId(taskId)
  );
}

function resolveOwner(task: RawTaskBoardTask): string | undefined {
  const claimedBy = asRecord(task.claimed_by);
  return (
    readString(claimedBy?.agent_name) ?? readString(claimedBy?.agent_id) ?? readString(task.owner)
  );
}

function resolveDependencyIds(task: RawTaskBoardTask): string[] {
  return normalizeTaskIdList(
    task.blocked_by ?? task.blockedBy ?? task.depends_on ?? task.dependencies,
  );
}

function resolveBlockerTexts(task: RawTaskBoardTask): string[] {
  const handoff = asRecord(task.handoff);
  const raw = [
    ...(Array.isArray(task.blockers) ? task.blockers : []),
    ...(Array.isArray(handoff?.blockers) ? handoff.blockers : []),
    task.blocker,
  ];
  const resolved = new Set<string>();
  const unresolved: string[] = [];
  const seen = new Set<string>();

  for (const entry of raw) {
    const text = readString(entry);
    if (!text) {
      continue;
    }
    const resolvedMatch = /^resolved\s*:\s*(.+)$/i.exec(text);
    if (resolvedMatch?.[1]) {
      resolved.add(resolvedMatch[1].trim().toLowerCase());
      continue;
    }
    const key = text.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unresolved.push(text);
  }

  return unresolved.filter((entry) => !resolved.has(entry.toLowerCase()));
}

function isTaskHidden(
  task: RawTaskBoardTask,
  rawStatus: string | undefined,
  lane: string | undefined,
) {
  const visibility = readString(task.visibility)?.toLowerCase();
  if (task.internal === true || task.private === true) {
    return true;
  }
  if (visibility === "internal" || visibility === "private" || visibility === "hidden") {
    return true;
  }
  if (rawStatus && HIDDEN_STATUSES.has(rawStatus)) {
    return true;
  }
  if (lane && HIDDEN_LANES.has(lane)) {
    return true;
  }
  return false;
}

function resolveStepSummary(task: RawTaskBoardTask): { stepCount?: number; stepsDone?: number } {
  if (!Array.isArray(task.steps)) {
    return {};
  }
  const steps = task.steps.filter((entry): entry is Record<string, unknown> =>
    Boolean(entry && typeof entry === "object"),
  );
  const stepCount = steps.length;
  const stepsDone = steps.filter(
    (step) => step.checked === true || readString(step.status) === "done",
  ).length;
  return {
    stepCount,
    stepsDone,
  };
}

function resolveNormalizedStatus(params: {
  rawStatus?: string;
  lane?: string;
  blockers: string[];
  blockedBy: string[];
}): { status: NormalizedTaskStatus; needsHuman: boolean; isPaused: boolean } {
  const rawStatus = params.rawStatus;
  const lane = params.lane;
  const needsHuman = Boolean(
    (rawStatus && HUMAN_STATUSES.has(rawStatus)) || (lane && HUMAN_LANES.has(lane)),
  );
  const isPaused = rawStatus === "paused" || Boolean(lane && PAUSED_LANES.has(lane));
  const isCompleted = Boolean(
    (rawStatus && COMPLETED_STATUSES.has(rawStatus)) || (lane && COMPLETED_LANES.has(lane)),
  );
  if (isCompleted) {
    return { status: "completed", needsHuman: false, isPaused: false };
  }
  if (
    needsHuman ||
    isPaused ||
    (rawStatus && BLOCKED_STATUSES.has(rawStatus)) ||
    params.blockers.length > 0 ||
    params.blockedBy.length > 0
  ) {
    return { status: "blocked", needsHuman, isPaused };
  }
  const isActive = Boolean(
    (rawStatus && ACTIVE_STATUSES.has(rawStatus)) || (lane && ACTIVE_LANES.has(lane)),
  );
  if (isActive) {
    return { status: "in_progress", needsHuman: false, isPaused: false };
  }
  return { status: "pending", needsHuman: false, isPaused: false };
}

function buildEmptySnapshot(board?: RawTaskBoard): TaskBoardSnapshot {
  return {
    version:
      typeof board?.version === "number" && Number.isFinite(board.version)
        ? board.version
        : undefined,
    updatedAt: readString(board?.updated_at),
    summary: {
      total: 0,
      pending: 0,
      in_progress: 0,
      completed: 0,
      blocked: 0,
      available: 0,
    },
    tasks: [],
    lanes: {},
  };
}

export function buildTaskBoardSnapshot(board: RawTaskBoard | null | undefined): TaskBoardSnapshot {
  if (!board || typeof board !== "object" || Array.isArray(board)) {
    return buildEmptySnapshot();
  }

  const tasksRecord = asRecord(board.tasks) ?? {};
  const laneMap = resolveLaneMap(board);
  const visibleTasks: NormalizedTaskSummary[] = [];
  const visibleTaskIdSet = new Set<string>();
  const completionByTaskId = new Map<string, boolean>();

  for (const [taskId, rawTask] of Object.entries(tasksRecord)) {
    const task = asRecord(rawTask) as RawTaskBoardTask | undefined;
    if (!task) {
      continue;
    }
    const rawStatus = readString(task.status)?.toLowerCase();
    const lane = resolveCanonicalLane(taskId, task, laneMap);
    if (isTaskHidden(task, rawStatus, lane)) {
      continue;
    }
    const isCompleted = Boolean(
      (rawStatus && COMPLETED_STATUSES.has(rawStatus)) || (lane && COMPLETED_LANES.has(lane)),
    );
    completionByTaskId.set(taskId, isCompleted);
  }

  for (const [taskId, rawTask] of Object.entries(tasksRecord)) {
    const task = asRecord(rawTask) as RawTaskBoardTask | undefined;
    if (!task) {
      continue;
    }
    const rawStatus = readString(task.status)?.toLowerCase();
    const lane = resolveCanonicalLane(taskId, task, laneMap);
    if (isTaskHidden(task, rawStatus, lane)) {
      continue;
    }

    const blockedBy = resolveDependencyIds(task).filter((dependencyId) => {
      const isCompleted = completionByTaskId.get(dependencyId);
      return isCompleted !== true;
    });
    const blockers = resolveBlockerTexts(task);
    const { status, needsHuman, isPaused } = resolveNormalizedStatus({
      rawStatus,
      lane,
      blockers,
      blockedBy,
    });
    const owner = resolveOwner(task);
    const hasOwner = Boolean(owner);
    const isAvailableToClaim =
      status === "pending" && !hasOwner && blockedBy.length === 0 && blockers.length === 0;
    const { stepCount, stepsDone } = resolveStepSummary(task);
    const title = resolvePrimaryTitle(taskId, task);
    visibleTasks.push({
      id: taskId,
      title,
      subject: title,
      status,
      rawStatus,
      lane,
      rawLane: readString(task.lane),
      owner,
      hasOwner,
      blockedBy,
      blockers,
      isBlocked: status === "blocked",
      isAvailableToClaim,
      isReady: isAvailableToClaim,
      readyReason: isAvailableToClaim
        ? "ready"
        : status === "completed"
          ? "completed"
          : status === "in_progress"
            ? "in_progress"
            : needsHuman
              ? "needs_human"
              : isPaused
                ? "paused"
                : blockedBy.length > 0
                  ? "blocked_by_tasks"
                  : blockers.length > 0
                    ? "blocked_by_note"
                    : status === "blocked"
                      ? "blocked"
                      : hasOwner
                        ? "claimed"
                        : "pending",
      needsHuman,
      isPaused,
      file: readString(task.file),
      plan: readString(task.plan),
      kind: readString(task.kind),
      summary: readString(task.summary),
      goal: readString(task.goal),
      nextAction: readString(task.next_action),
      next_action: readString(task.next_action),
      progress: readString(task.progress),
      stepCount,
      stepsDone,
    });
    visibleTaskIdSet.add(taskId);
  }

  visibleTasks.sort((a, b) => compareTaskIds(a.id, b.id));

  const summary: TaskBoardSummary = {
    total: visibleTasks.length,
    pending: visibleTasks.filter((task) => task.status === "pending").length,
    in_progress: visibleTasks.filter((task) => task.status === "in_progress").length,
    completed: visibleTasks.filter((task) => task.status === "completed").length,
    blocked: visibleTasks.filter((task) => task.status === "blocked").length,
    available: visibleTasks.filter((task) => task.isAvailableToClaim).length,
  };

  const filteredLanes: Record<string, string[]> = {};
  const lanes = asRecord(board.lanes) ?? {};
  for (const [laneName, rawIds] of Object.entries(lanes)) {
    filteredLanes[laneName] = normalizeTaskIdList(rawIds)
      .filter((taskId) => visibleTaskIdSet.has(taskId))
      .toSorted(compareTaskIds);
  }

  return {
    version:
      typeof board.version === "number" && Number.isFinite(board.version)
        ? board.version
        : undefined,
    updatedAt: readString(board.updated_at),
    summary,
    tasks: visibleTasks,
    lanes: filteredLanes,
  };
}

export async function loadTaskBoardSnapshot(params: {
  workspaceDir: string;
}): Promise<LoadTaskBoardSnapshotResult> {
  const boardPath = path.join(params.workspaceDir, TASK_BOARD_RELATIVE_PATH);
  let board: RawTaskBoard = {};
  try {
    const raw = await fs.readFile(boardPath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    board =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as RawTaskBoard)
        : {};
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code?: unknown }).code)
        : undefined;
    if (code !== "ENOENT") {
      throw err;
    }
  }
  return {
    boardPath,
    board,
    snapshot: buildTaskBoardSnapshot(board),
  };
}

export function getTaskBoardTaskDetail(params: {
  board: RawTaskBoard;
  snapshot: TaskBoardSnapshot;
  taskId: string;
}): NormalizedTaskDetail | null {
  const task = params.snapshot.tasks.find((entry) => entry.id === params.taskId);
  if (!task) {
    return null;
  }
  const rawTask = (asRecord(params.board.tasks)?.[params.taskId] ?? {}) as RawTaskBoardTask;
  const rawSteps = Array.isArray(rawTask.steps) ? rawTask.steps : [];
  const steps = rawSteps
    .filter((entry): entry is Record<string, unknown> =>
      Boolean(entry && typeof entry === "object"),
    )
    .map((step) => ({
      id: readString(step.id),
      text: readString(step.text),
      status: readString(step.status),
      checked: step.checked === true,
    }));

  return {
    ...task,
    createdAt: readString(rawTask.created_at),
    updatedAt: readString(rawTask.updated_at),
    startedAt: readString(rawTask.started_at),
    currentStep:
      typeof rawTask.current_step === "number" && Number.isFinite(rawTask.current_step)
        ? rawTask.current_step
        : undefined,
    current_step:
      typeof rawTask.current_step === "number" && Number.isFinite(rawTask.current_step)
        ? rawTask.current_step
        : undefined,
    steps,
    context: asRecord(rawTask.context),
    links: Array.isArray(rawTask.links) ? rawTask.links : undefined,
    handoff: asRecord(rawTask.handoff),
  };
}

function formatTaskLine(task: NormalizedTaskSummary): string {
  const owner = task.owner ?? "none";
  const blockedBy = task.blockedBy.length > 0 ? task.blockedBy.join(", ") : "none";
  const blockers = task.blockers.length > 0 ? task.blockers.join(" | ") : "none";
  return (
    `- ${task.id} | ${task.title} | status=${task.status} | lane=${task.lane ?? "none"} | ` +
    `ready=${task.isAvailableToClaim ? "yes" : "no"} | owner=${owner} | blocked_by=${blockedBy} | blockers=${blockers}`
  );
}

export function renderTaskBoardList(snapshot: TaskBoardSnapshot): string {
  const lines: string[] = [];
  lines.push("Task board summary");
  lines.push(
    `- total=${snapshot.summary.total} pending=${snapshot.summary.pending} in_progress=${snapshot.summary.in_progress} completed=${snapshot.summary.completed} blocked=${snapshot.summary.blocked} available=${snapshot.summary.available}`,
  );

  if (snapshot.tasks.length === 0) {
    lines.push("No visible tasks are available on the task board.");
    return lines.join("\n");
  }

  const ready = snapshot.tasks.filter((task) => task.isAvailableToClaim);
  const inProgress = snapshot.tasks.filter((task) => task.status === "in_progress");
  const blocked = snapshot.tasks.filter((task) => task.status === "blocked");
  const pending = snapshot.tasks.filter(
    (task) => task.status === "pending" && !task.isAvailableToClaim,
  );
  const completed = snapshot.tasks.filter((task) => task.status === "completed");

  const appendSection = (label: string, tasks: NormalizedTaskSummary[]) => {
    if (tasks.length === 0) {
      return;
    }
    lines.push("");
    lines.push(`${label}:`);
    for (const task of tasks) {
      lines.push(formatTaskLine(task));
    }
  };

  appendSection("Ready now (lowest-ID first)", ready);
  appendSection("In progress", inProgress);
  appendSection("Blocked or waiting", blocked);
  appendSection("Other pending", pending);
  appendSection("Completed", completed);

  lines.push("");
  lines.push("Use task_get with a task id for the full task card before acting.");
  return lines.join("\n");
}

export function renderTaskBoardTaskDetail(detail: NormalizedTaskDetail): string {
  const lines: string[] = [];
  const contextSummary = readString(detail.context?.summary);
  lines.push(`Task ${detail.id}: ${detail.title}`);
  lines.push(
    `Status: ${detail.status}${detail.rawStatus ? ` (raw=${detail.rawStatus})` : ""} | Lane: ${detail.lane ?? "none"}${detail.rawLane && detail.rawLane !== detail.lane ? ` (raw=${detail.rawLane})` : ""}`,
  );
  lines.push(
    `Ready: ${detail.isAvailableToClaim ? "yes" : "no"} (${detail.readyReason}) | Owner: ${detail.owner ?? "none"}`,
  );
  lines.push(
    `Blocked by tasks: ${detail.blockedBy.length > 0 ? detail.blockedBy.join(", ") : "none"}`,
  );
  lines.push(`Blockers: ${detail.blockers.length > 0 ? detail.blockers.join(" | ") : "none"}`);

  if (detail.summary) {
    lines.push(`Summary: ${detail.summary}`);
  }
  if (detail.goal) {
    lines.push(`Goal: ${detail.goal}`);
  }
  if (contextSummary) {
    lines.push(`Context: ${contextSummary}`);
  }
  if (detail.progress) {
    lines.push(`Progress: ${detail.progress}`);
  } else if (typeof detail.stepsDone === "number" && typeof detail.stepCount === "number") {
    lines.push(`Progress: ${detail.stepsDone}/${detail.stepCount} steps done`);
  }
  if (detail.nextAction) {
    lines.push(`Next action: ${detail.nextAction}`);
  }
  if (detail.file) {
    lines.push(`Task file: ${detail.file}`);
  }
  if (detail.plan) {
    lines.push(`Plan file: ${detail.plan}`);
  }

  if (detail.steps && detail.steps.length > 0) {
    lines.push("");
    lines.push("Steps:");
    for (const step of detail.steps) {
      const marker = step.checked || step.status === "done" ? "[x]" : "[ ]";
      const stepId = step.id ? `${step.id}: ` : "";
      lines.push(`- ${marker} ${stepId}${step.text ?? "(untitled step)"}`);
    }
  }

  if (detail.links && detail.links.length > 0) {
    lines.push("");
    lines.push("Links:");
    for (const entry of detail.links.slice(0, 5)) {
      if (typeof entry === "string") {
        lines.push(`- ${entry}`);
        continue;
      }
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        continue;
      }
      const link = entry as Record<string, unknown>;
      const label = readString(link.label);
      const url = readString(link.url);
      if (label && url) {
        lines.push(`- ${label}: ${url}`);
      } else if (url) {
        lines.push(`- ${url}`);
      } else if (label) {
        lines.push(`- ${label}`);
      }
    }
  }

  lines.push("");
  lines.push(
    "Use read on the task file or plan file when you need the raw markdown/source context.",
  );
  return lines.join("\n");
}
