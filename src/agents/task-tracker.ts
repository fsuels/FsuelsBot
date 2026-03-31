import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { loadConfig } from "../config/config.js";
import {
  loadSessionStore,
  resolveSessionTranscriptsDirForAgent,
  resolveStorePath,
} from "../config/sessions.js";
import {
  DEFAULT_AGENT_ID,
  normalizeAgentId,
  resolveAgentIdFromSessionKey,
} from "../routing/session-key.js";

export const TaskTrackerStatusSchema = z.enum(["pending", "in_progress", "blocked", "completed"]);
export const TaskTrackerTypeSchema = z.enum([
  "implementation",
  "test",
  "verification",
  "follow_up",
]);
export const TaskTrackerSessionStateSchema = z.enum(["active", "blocked", "done"]);

export type TaskTrackerStatus = z.infer<typeof TaskTrackerStatusSchema>;
export type TaskTrackerType = z.infer<typeof TaskTrackerTypeSchema>;
export type TaskTrackerSessionState = z.infer<typeof TaskTrackerSessionStateSchema>;

const IsoDateStringSchema = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: "Expected ISO timestamp",
});
const TaskTrackerMetadataSchema = z.record(z.string(), z.unknown());

const BaseTaskTrackerTaskSchema = z.object({
  id: z.string().trim().min(1),
  content: z.string().trim().min(1),
  subject: z.string().trim().min(1).optional(),
  description: z.string().trim().min(1).optional(),
  activeForm: z.string().trim().min(1),
  status: TaskTrackerStatusSchema,
  type: TaskTrackerTypeSchema,
  ownerAgentId: z.string().trim().min(1),
  sessionId: z.string().trim().min(1),
  createdAt: IsoDateStringSchema,
  updatedAt: IsoDateStringSchema,
  metadata: TaskTrackerMetadataSchema.optional(),
  blockedReason: z.string().trim().min(1).optional(),
  unblockAction: z.string().trim().min(1).optional(),
  followUpTaskId: z.string().trim().min(1).optional(),
  abandonedReason: z.string().trim().min(1).optional(),
});

export const TaskTrackerTaskSchema = BaseTaskTrackerTaskSchema.superRefine((task, ctx) => {
  if (task.status !== "blocked") {
    return;
  }
  if (!task.blockedReason) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["blockedReason"],
      message: "blocked tasks require blockedReason",
    });
  }
  if (!task.unblockAction && !task.followUpTaskId && !task.abandonedReason) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["unblockAction"],
      message: "blocked tasks require unblockAction, followUpTaskId, or abandonedReason",
    });
  }
});

const TaskTrackerTaskInputSchema = z
  .object({
    id: z.string().trim().min(1),
    content: z.string().trim().min(1),
    subject: z.string().trim().min(1).optional(),
    description: z.string().trim().min(1).optional(),
    activeForm: z.string().trim().min(1),
    status: TaskTrackerStatusSchema,
    type: TaskTrackerTypeSchema,
    ownerAgentId: z.string().trim().min(1).optional(),
    sessionId: z.string().trim().min(1).optional(),
    createdAt: IsoDateStringSchema.optional(),
    updatedAt: IsoDateStringSchema.optional(),
    metadata: TaskTrackerMetadataSchema.optional(),
    blockedReason: z.string().trim().min(1).optional(),
    unblockAction: z.string().trim().min(1).optional(),
    followUpTaskId: z.string().trim().min(1).optional(),
    abandonedReason: z.string().trim().min(1).optional(),
  })
  .strict()
  .superRefine((task, ctx) => {
    if (task.status !== "blocked") {
      return;
    }
    if (!task.blockedReason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["blockedReason"],
        message: "blocked tasks require blockedReason",
      });
    }
    if (!task.unblockAction && !task.followUpTaskId && !task.abandonedReason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["unblockAction"],
        message: "blocked tasks require unblockAction, followUpTaskId, or abandonedReason",
      });
    }
  });

export type TaskTrackerTask = z.infer<typeof TaskTrackerTaskSchema>;
export type TaskTrackerTaskInput = z.infer<typeof TaskTrackerTaskInputSchema>;
export type TaskTrackerCreateValidator = (params: {
  task: TaskTrackerTask;
  nextState: TaskTrackerState;
  previousState: TaskTrackerState;
  context: TaskTrackerContext;
}) => void | string | string[] | Promise<void | string | string[]>;

export const TaskTrackerStateSchema = z
  .object({
    version: z.literal(1),
    agentId: z.string().trim().min(1),
    sessionId: z.string().trim().min(1),
    updatedAt: IsoDateStringSchema,
    activeTasks: z.array(TaskTrackerTaskSchema),
    archivedTasks: z.array(TaskTrackerTaskSchema),
    submittedTasks: z.array(TaskTrackerTaskSchema),
    sessionState: TaskTrackerSessionStateSchema,
  })
  .strict();

export type TaskTrackerState = z.infer<typeof TaskTrackerStateSchema>;

export type TaskTrackerContext = {
  agentId: string;
  sessionId: string;
  sessionsDir?: string;
};

export type TaskTrackerUpdateResult = {
  state: TaskTrackerState;
  autoCreatedTasks: TaskTrackerTask[];
  finalizationBlocked: boolean;
  finalizationReason?: string;
};

export type TaskTrackerCreateResult = TaskTrackerUpdateResult & {
  task: TaskTrackerTask;
  created: boolean;
  duplicate: boolean;
};

export type TaskTrackerTaskPatchResult = TaskTrackerUpdateResult & {
  task: TaskTrackerTask;
};

function toIsoString(value?: number): string {
  return new Date(value ?? Date.now()).toISOString();
}

function normalizeTaskOwnerContext(value?: string): string {
  const normalized = normalizeAgentId(value ?? DEFAULT_AGENT_ID);
  return normalized || DEFAULT_AGENT_ID;
}

function getTaskSubject(task: Pick<TaskTrackerTask, "content"> & { subject?: string }): string {
  return task.subject?.trim() || task.content;
}

function taskLabel(task: Pick<TaskTrackerTask, "id" | "content"> & { subject?: string }): string {
  return `${task.id} (${getTaskSubject(task)})`;
}

function normalizeTaskSubjectForComparison(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function deriveDefaultActiveForm(subject: string): string {
  return `Working on: ${subject}`;
}

function deriveFollowUpActiveForm(content: string): string {
  return `Following up on: ${content}`;
}

function buildAutoTask(params: {
  id: string;
  content: string;
  activeForm: string;
  type: TaskTrackerType;
  nowIso: string;
  context: TaskTrackerContext;
}): TaskTrackerTask {
  return TaskTrackerTaskSchema.parse({
    id: params.id,
    content: params.content,
    subject: params.content,
    description: params.content,
    activeForm: params.activeForm,
    status: "pending",
    type: params.type,
    ownerAgentId: params.context.agentId,
    sessionId: params.context.sessionId,
    createdAt: params.nowIso,
    updatedAt: params.nowIso,
  });
}

function makeUniqueTaskId(base: string, existingIds: Set<string>, nowIso: string): string {
  const normalizedBase = base
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const stem = normalizedBase || `task-${nowIso.slice(0, 19).replace(/[:T]/g, "-")}`;
  let nextId = stem;
  let counter = 2;
  while (existingIds.has(nextId)) {
    nextId = `${stem}-${counter}`;
    counter += 1;
  }
  return nextId;
}

function findTaskById(state: TaskTrackerState, taskId: string): TaskTrackerTask | undefined {
  return (
    state.activeTasks.find((task) => task.id === taskId) ??
    state.archivedTasks.find((task) => task.id === taskId) ??
    state.submittedTasks.find((task) => task.id === taskId)
  );
}

function findDuplicateActiveTaskBySubject(
  state: TaskTrackerState,
  subject: string,
): TaskTrackerTask | undefined {
  const normalizedSubject = normalizeTaskSubjectForComparison(subject);
  if (!normalizedSubject) {
    return undefined;
  }
  return state.activeTasks.find(
    (task) => normalizeTaskSubjectForComparison(getTaskSubject(task)) === normalizedSubject,
  );
}

function transitionIsAllowed(previous: TaskTrackerStatus, next: TaskTrackerStatus): boolean {
  if (previous === next) {
    return true;
  }
  if (previous === "completed") {
    return next === "completed";
  }
  if (previous === "blocked") {
    return next === "blocked" || next === "in_progress";
  }
  if (previous === "in_progress") {
    return next === "blocked" || next === "completed" || next === "in_progress";
  }
  if (previous === "pending") {
    return (
      next === "pending" || next === "in_progress" || next === "blocked" || next === "completed"
    );
  }
  return false;
}

function assertUniqueTaskIds(tasks: TaskTrackerTaskInput[]): void {
  const seen = new Set<string>();
  for (const task of tasks) {
    if (seen.has(task.id)) {
      throw new Error(`Duplicate task id: ${task.id}`);
    }
    seen.add(task.id);
  }
}

function assertSingleInProgress(tasks: TaskTrackerTask[]): void {
  const inProgress = tasks.filter((task) => task.status === "in_progress");
  if (inProgress.length > 1) {
    throw new Error("Exactly one task may be in_progress per session context.");
  }
}

function resolveExistingTaskMap(existing: TaskTrackerState): Map<string, TaskTrackerTask> {
  const map = new Map<string, TaskTrackerTask>();
  for (const task of existing.archivedTasks) {
    map.set(task.id, task);
  }
  for (const task of existing.activeTasks) {
    map.set(task.id, task);
  }
  for (const task of existing.submittedTasks) {
    map.set(task.id, task);
  }
  return map;
}

function normalizeSubmittedTask(params: {
  raw: TaskTrackerTaskInput;
  existing?: TaskTrackerTask;
  context: TaskTrackerContext;
  nowIso: string;
}): TaskTrackerTask {
  const ownerAgentId = normalizeTaskOwnerContext(
    params.raw.ownerAgentId ?? params.existing?.ownerAgentId ?? params.context.agentId,
  );
  if (ownerAgentId !== params.context.agentId) {
    throw new Error(
      `Task ${params.raw.id} ownerAgentId mismatch: expected ${params.context.agentId}, got ${ownerAgentId}`,
    );
  }
  const sessionId = (params.raw.sessionId ?? params.existing?.sessionId ?? "").trim();
  if (sessionId && sessionId !== params.context.sessionId) {
    throw new Error(
      `Task ${params.raw.id} sessionId mismatch: expected ${params.context.sessionId}, got ${sessionId}`,
    );
  }
  if (params.existing) {
    const previous = params.existing.status;
    const next = params.raw.status;
    if (!transitionIsAllowed(previous, next)) {
      throw new Error(`Invalid task transition: ${params.raw.id} ${previous} -> ${next}`);
    }
  }
  return TaskTrackerTaskSchema.parse({
    ...params.raw,
    ownerAgentId: params.context.agentId,
    sessionId: params.context.sessionId,
    createdAt: params.raw.createdAt ?? params.existing?.createdAt ?? params.nowIso,
    updatedAt: params.nowIso,
  });
}

function carryForwardFollowUpTask(params: {
  followUpTaskId: string;
  existingById: Map<string, TaskTrackerTask>;
  activeTasks: TaskTrackerTask[];
  activeTaskIds: Set<string>;
}): TaskTrackerTask | null {
  const existing = params.existingById.get(params.followUpTaskId);
  if (!existing || existing.type !== "follow_up" || existing.status === "completed") {
    return null;
  }
  if (params.activeTaskIds.has(existing.id)) {
    return existing;
  }
  params.activeTasks.push(existing);
  params.activeTaskIds.add(existing.id);
  return existing;
}

function ensureBlockedFollowUps(params: {
  submittedTasks: TaskTrackerTask[];
  existingById: Map<string, TaskTrackerTask>;
  context: TaskTrackerContext;
  nowIso: string;
}): TaskTrackerTask[] {
  const activeTasks = [...params.submittedTasks];
  const activeTaskIds = new Set(activeTasks.map((task) => task.id));
  const autoCreated: TaskTrackerTask[] = [];

  for (const task of params.submittedTasks) {
    if (task.status !== "blocked") {
      continue;
    }

    const followUpTaskId =
      task.followUpTaskId ??
      (task.unblockAction
        ? makeUniqueTaskId(`${task.id}-follow-up`, activeTaskIds, params.nowIso)
        : undefined);

    if (!followUpTaskId) {
      throw new Error(`Blocked task ${task.id} requires a follow-up task or unblockAction.`);
    }
    task.followUpTaskId = followUpTaskId;

    if (
      carryForwardFollowUpTask({
        followUpTaskId,
        existingById: params.existingById,
        activeTasks,
        activeTaskIds,
      })
    ) {
      continue;
    }
    if (activeTaskIds.has(followUpTaskId)) {
      const existing = activeTasks.find((candidate) => candidate.id === followUpTaskId);
      if (existing?.type !== "follow_up") {
        throw new Error(
          `Blocked task ${task.id} follow-up id ${followUpTaskId} must reference a follow_up task.`,
        );
      }
      continue;
    }
    if (!task.unblockAction) {
      throw new Error(
        `Blocked task ${task.id} followUpTaskId ${followUpTaskId} is missing and no unblockAction was provided.`,
      );
    }
    const followUpTask = buildAutoTask({
      id: followUpTaskId,
      content: task.unblockAction,
      activeForm: deriveFollowUpActiveForm(task.unblockAction),
      type: "follow_up",
      nowIso: params.nowIso,
      context: params.context,
    });
    activeTasks.push(followUpTask);
    activeTaskIds.add(followUpTask.id);
    autoCreated.push(followUpTask);
  }

  return autoCreated;
}

function buildArchivedTasks(params: {
  existing: TaskTrackerState;
  allTasks: TaskTrackerTask[];
}): TaskTrackerTask[] {
  const completed = params.allTasks.filter((task) => task.status === "completed");
  const replaced = new Set(completed.map((task) => task.id));
  return [...params.existing.archivedTasks.filter((task) => !replaced.has(task.id)), ...completed];
}

function buildFinalizationGuard(params: {
  archivedTasks: TaskTrackerTask[];
  activeTasks: TaskTrackerTask[];
}): { blocked: boolean; reason?: string } {
  const completedCount = params.archivedTasks.length;
  const hasCompletedVerification = params.archivedTasks.some(
    (task) => task.type === "verification" && task.status === "completed",
  );
  if (completedCount >= 3 && !hasCompletedVerification && params.activeTasks.length === 0) {
    return {
      blocked: true,
      reason:
        "Verification required before finalization because 3 or more tasks were completed in this session.",
    };
  }
  return { blocked: false };
}

function appendVerificationTaskIfNeeded(params: {
  activeTasks: TaskTrackerTask[];
  autoCreatedTasks: TaskTrackerTask[];
  archivedTasks: TaskTrackerTask[];
  context: TaskTrackerContext;
  nowIso: string;
}): { finalizationBlocked: boolean; finalizationReason?: string } {
  const guard = buildFinalizationGuard({
    archivedTasks: params.archivedTasks,
    activeTasks: params.activeTasks,
  });
  if (!guard.blocked) {
    return { finalizationBlocked: false };
  }
  const activeTaskIds = new Set(params.activeTasks.map((task) => task.id));
  const verificationTask = buildAutoTask({
    id: makeUniqueTaskId("verification", activeTaskIds, params.nowIso),
    content: "Run verification before final summary",
    activeForm: "Running verification before final summary",
    type: "verification",
    nowIso: params.nowIso,
    context: params.context,
  });
  params.activeTasks.push(verificationTask);
  params.autoCreatedTasks.push(verificationTask);
  return {
    finalizationBlocked: true,
    finalizationReason: guard.reason,
  };
}

function computeSessionState(params: {
  activeTasks: TaskTrackerTask[];
  didFinishSubmittedTasks: boolean;
}): TaskTrackerSessionState {
  const hasBlockingTask = params.activeTasks.some(
    (task) => task.status === "blocked" && !task.abandonedReason,
  );
  if (hasBlockingTask) {
    return "blocked";
  }
  if (params.didFinishSubmittedTasks && params.activeTasks.length === 0) {
    return "done";
  }
  return "active";
}

export function createEmptyTaskTrackerState(context: TaskTrackerContext): TaskTrackerState {
  return {
    version: 1,
    agentId: context.agentId,
    sessionId: context.sessionId,
    updatedAt: toIsoString(),
    activeTasks: [],
    archivedTasks: [],
    submittedTasks: [],
    sessionState: "active",
  };
}

export function resolveTaskTrackerStatePath(params: TaskTrackerContext): string {
  const sessionsDir = params.sessionsDir ?? resolveSessionTranscriptsDirForAgent(params.agentId);
  return path.join(sessionsDir, "task-tracker", `${params.sessionId}.json`);
}

export async function loadTaskTrackerState(context: TaskTrackerContext): Promise<TaskTrackerState> {
  const filePath = resolveTaskTrackerStatePath(context);
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf-8");
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code?: unknown }).code)
        : undefined;
    if (code === "ENOENT") {
      return createEmptyTaskTrackerState(context);
    }
    throw err;
  }
  return TaskTrackerStateSchema.parse(JSON.parse(raw) as unknown);
}

export async function saveTaskTrackerState(
  context: TaskTrackerContext,
  state: TaskTrackerState,
): Promise<void> {
  const filePath = resolveTaskTrackerStatePath(context);
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(tmpPath, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
  await fs.rename(tmpPath, filePath);
}

export function applyTaskTrackerUpdate(params: {
  existing: TaskTrackerState;
  tasks: TaskTrackerTaskInput[];
  context: TaskTrackerContext;
  now?: number;
}): TaskTrackerUpdateResult {
  const nowIso = toIsoString(params.now);
  assertUniqueTaskIds(params.tasks);
  const existingById = resolveExistingTaskMap(params.existing);
  const submittedTasks = params.tasks.map((task) =>
    normalizeSubmittedTask({
      raw: TaskTrackerTaskInputSchema.parse(task),
      existing: existingById.get(task.id),
      context: params.context,
      nowIso,
    }),
  );
  assertSingleInProgress(submittedTasks);

  const autoCreatedTasks = ensureBlockedFollowUps({
    submittedTasks,
    existingById,
    context: params.context,
    nowIso,
  });
  const allTasks = [...submittedTasks, ...autoCreatedTasks];
  assertSingleInProgress(allTasks);

  const archivedTasks = buildArchivedTasks({
    existing: params.existing,
    allTasks,
  });
  const activeTasks = allTasks.filter((task) => task.status !== "completed");

  const verificationGuard = appendVerificationTaskIfNeeded({
    activeTasks,
    autoCreatedTasks,
    archivedTasks,
    context: params.context,
    nowIso,
  });
  assertSingleInProgress(activeTasks);

  const didFinishSubmittedTasks = submittedTasks.length > 0 && activeTasks.length === 0;
  const nextState = TaskTrackerStateSchema.parse({
    version: 1,
    agentId: params.context.agentId,
    sessionId: params.context.sessionId,
    updatedAt: nowIso,
    activeTasks,
    archivedTasks,
    submittedTasks,
    sessionState: computeSessionState({
      activeTasks,
      didFinishSubmittedTasks: didFinishSubmittedTasks && !verificationGuard.finalizationBlocked,
    }),
  });

  return {
    state: nextState,
    autoCreatedTasks,
    finalizationBlocked: verificationGuard.finalizationBlocked,
    finalizationReason: verificationGuard.finalizationReason,
  };
}

export async function replaceTaskTrackerState(params: {
  context: TaskTrackerContext;
  tasks: TaskTrackerTaskInput[];
  now?: number;
}): Promise<TaskTrackerUpdateResult> {
  const existing = await loadTaskTrackerState(params.context);
  const result = applyTaskTrackerUpdate({
    existing,
    tasks: params.tasks,
    context: params.context,
    now: params.now,
  });
  await saveTaskTrackerState(params.context, result.state);
  return result;
}

async function runTaskCreateValidators(params: {
  validators: TaskTrackerCreateValidator[];
  task: TaskTrackerTask;
  nextState: TaskTrackerState;
  previousState: TaskTrackerState;
  context: TaskTrackerContext;
}): Promise<string[]> {
  const errors: string[] = [];
  for (const validator of params.validators) {
    const result = await validator({
      task: params.task,
      nextState: params.nextState,
      previousState: params.previousState,
      context: params.context,
    });
    if (typeof result === "string") {
      const message = result.trim();
      if (message) {
        errors.push(message);
      }
      continue;
    }
    if (!Array.isArray(result)) {
      continue;
    }
    for (const entry of result) {
      if (typeof entry !== "string") {
        continue;
      }
      const message = entry.trim();
      if (message) {
        errors.push(message);
      }
    }
  }
  return errors;
}

export async function createTaskTrackerTask(params: {
  context: TaskTrackerContext;
  subject: string;
  description: string;
  activeForm?: string;
  metadata?: Record<string, unknown>;
  now?: number;
  validators?: TaskTrackerCreateValidator[];
}): Promise<TaskTrackerCreateResult> {
  const existing = await loadTaskTrackerState(params.context);
  const duplicate = findDuplicateActiveTaskBySubject(existing, params.subject);
  if (duplicate) {
    return {
      state: existing,
      task: duplicate,
      created: false,
      duplicate: true,
      autoCreatedTasks: [],
      finalizationBlocked: false,
      finalizationReason: undefined,
    };
  }

  const nowIso = toIsoString(params.now);
  const existingIds = new Set<string>();
  for (const task of [
    ...existing.activeTasks,
    ...existing.archivedTasks,
    ...existing.submittedTasks,
  ]) {
    existingIds.add(task.id);
  }
  const nextTask = TaskTrackerTaskSchema.parse({
    id: makeUniqueTaskId(params.subject, existingIds, nowIso),
    content: params.description,
    subject: params.subject,
    description: params.description,
    activeForm: params.activeForm?.trim() || deriveDefaultActiveForm(params.subject),
    status: "pending",
    type: "implementation",
    ownerAgentId: params.context.agentId,
    sessionId: params.context.sessionId,
    createdAt: nowIso,
    updatedAt: nowIso,
    metadata: params.metadata,
  });

  const result = applyTaskTrackerUpdate({
    existing,
    tasks: [...existing.activeTasks, nextTask],
    context: params.context,
    now: params.now,
  });
  const createdTask = findTaskById(result.state, nextTask.id);
  if (!createdTask) {
    throw new Error(`Task creation failed to persist task ${nextTask.id}`);
  }

  const validationErrors = await runTaskCreateValidators({
    validators: params.validators ?? [],
    task: createdTask,
    nextState: result.state,
    previousState: existing,
    context: params.context,
  });
  if (validationErrors.length > 0) {
    throw new Error(`Task creation blocked: ${validationErrors.join("; ")}`);
  }

  await saveTaskTrackerState(params.context, result.state);
  return {
    ...result,
    state: result.state,
    task: createdTask,
    created: true,
    duplicate: false,
  };
}

export async function updateTaskTrackerTask(params: {
  context: TaskTrackerContext;
  taskId: string;
  status?: TaskTrackerStatus;
  activeForm?: string;
  subject?: string;
  description?: string;
  metadata?: Record<string, unknown>;
  blockedReason?: string;
  unblockAction?: string;
  followUpTaskId?: string;
  abandonedReason?: string;
  now?: number;
}): Promise<TaskTrackerTaskPatchResult> {
  const existing = await loadTaskTrackerState(params.context);
  const current = existing.activeTasks.find((task) => task.id === params.taskId);
  if (!current) {
    throw new Error(`Active task not found: ${params.taskId}`);
  }

  const nextDescription = params.description?.trim() || current.description || current.content;
  const patchedTask: TaskTrackerTaskInput = {
    ...current,
    ...(params.status ? { status: params.status } : {}),
    ...(params.activeForm?.trim() ? { activeForm: params.activeForm.trim() } : {}),
    ...(params.subject?.trim() ? { subject: params.subject.trim() } : {}),
    ...(params.description?.trim()
      ? {
          description: nextDescription,
          content: nextDescription,
        }
      : {}),
    ...(params.metadata !== undefined ? { metadata: params.metadata } : {}),
    ...(params.blockedReason?.trim() ? { blockedReason: params.blockedReason.trim() } : {}),
    ...(params.unblockAction?.trim() ? { unblockAction: params.unblockAction.trim() } : {}),
    ...(params.followUpTaskId?.trim() ? { followUpTaskId: params.followUpTaskId.trim() } : {}),
    ...(params.abandonedReason?.trim() ? { abandonedReason: params.abandonedReason.trim() } : {}),
  };

  const result = applyTaskTrackerUpdate({
    existing,
    tasks: existing.activeTasks.map((task) => (task.id === params.taskId ? patchedTask : task)),
    context: params.context,
    now: params.now,
  });
  const updatedTask = findTaskById(result.state, params.taskId);
  if (!updatedTask) {
    throw new Error(`Task update removed task ${params.taskId}`);
  }

  await saveTaskTrackerState(params.context, result.state);
  return {
    ...result,
    task: updatedTask,
  };
}

export async function resolveTaskTrackerContextFromSessionKey(
  sessionKey: string,
): Promise<TaskTrackerContext> {
  const cfg = loadConfig();
  const agentId = normalizeTaskOwnerContext(resolveAgentIdFromSessionKey(sessionKey));
  const storePath = resolveStorePath(cfg.session?.store, { agentId });
  const store = loadSessionStore(storePath);
  const entry = store[sessionKey];
  const sessionId = entry?.sessionId?.trim();
  if (!sessionId) {
    throw new Error(`Current session not found for task_tracker: ${sessionKey}`);
  }
  return {
    agentId,
    sessionId,
  };
}

export function formatTaskTrackerStateForPrompt(state: TaskTrackerState): string {
  const lines: string[] = [];
  lines.push("# Task Tracker");
  lines.push("");
  lines.push(`Session state: ${state.sessionState}`);
  if (state.activeTasks.length > 0) {
    lines.push("");
    lines.push("## Active Tasks");
    for (const task of state.activeTasks) {
      const subject = getTaskSubject(task);
      const description = task.description?.trim();
      lines.push(
        `- [${task.status}] ${task.id} (${task.type}) ${subject}` +
          (description && description !== subject ? ` :: ${description}` : ""),
      );
    }
  }
  if (state.archivedTasks.length > 0) {
    lines.push("");
    lines.push("## Archived Tasks");
    for (const task of state.archivedTasks.slice(-5)) {
      const subject = getTaskSubject(task);
      const description = task.description?.trim();
      lines.push(
        `- [${task.status}] ${task.id} (${task.type}) ${subject}` +
          (description && description !== subject ? ` :: ${description}` : ""),
      );
    }
  }
  lines.push("");
  lines.push(
    "*Use the task_tracker tool to update this state rather than describing progress from memory.*",
  );
  return lines.join("\n");
}

export function summarizeTaskTrackerUpdate(
  result: TaskTrackerUpdateResult,
): Record<string, unknown> {
  return {
    activeTasks: result.state.activeTasks,
    archivedTasks: result.state.archivedTasks,
    submittedTasks: result.state.submittedTasks,
    sessionState: result.state.sessionState,
    finalizationBlocked: result.finalizationBlocked,
    finalizationReason: result.finalizationReason,
    autoCreatedTasks: result.autoCreatedTasks.map((task) => ({
      id: task.id,
      type: task.type,
      subject: getTaskSubject(task),
      content: task.content,
    })),
  };
}

export function explainTaskTrackerState(state: TaskTrackerState): string {
  const active = state.activeTasks.map((task) => taskLabel(task)).join(", ") || "none";
  const archived = state.archivedTasks.map((task) => taskLabel(task)).join(", ") || "none";
  return `sessionState=${state.sessionState}; activeTasks=${active}; archivedTasks=${archived}`;
}
