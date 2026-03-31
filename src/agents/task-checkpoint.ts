/**
 * Task Checkpoint System
 *
 * Reads the active task card from tasks.json and produces:
 * 1. Compaction instructions — tells Claude what progress to preserve during summary
 * 2. Bootstrap context — injects the active task card into new sessions
 *
 * This prevents the "step 8 → step 4 regression" problem when context is compacted
 * or a new session starts.
 */

import fs from "node:fs/promises";
import {
  bumpTaskBoardRevision,
  resolveTaskBoardPath,
  resolveTaskBoardRevision,
  withTaskBoardLock,
  type TaskBoardRevision,
} from "../infra/task-board.js";
import { normalizeTaskReadiness, type TaskNextRecommendedAction } from "../infra/task-readiness.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("task-checkpoint");

export type TaskStep = {
  id: string;
  text: string;
  status: "todo" | "in_progress" | "done";
  checked?: boolean;
  output?: string;
};

export type ActiveTaskSummary = {
  taskId: string;
  title: string;
  goal?: string;
  totalSteps: number;
  completedSteps: number;
  currentStepIndex: number;
  currentStepText?: string;
  stepsCompleted: string[];
  stepsRemaining: string[];
  keyOutputs: string[];
  blockers: string[];
  resolvedBlockers: string[];
  canStart: boolean;
  nextRecommendedAction: TaskNextRecommendedAction;
  nextAction?: string;
  decisions: string[];
  constraints: string[];
  links: string[];
};

type TaskBoard = {
  version?: number;
  lanes?: {
    bot_current?: string[];
    bot_queue?: string[];
    [key: string]: unknown;
  };
  tasks?: Record<string, TaskEntry>;
  [key: string]: unknown;
};

type TaskEntry = {
  title?: string;
  status?: string;
  lane?: string;
  created_at?: string;
  updated_at?: string;
  goal?: string;
  summary?: string;
  steps?: TaskStep[];
  current_step?: number;
  next_action?: string;
  blockers?: string[];
  progress?: string;
  handoff?: {
    whatIsDone?: string;
    nextAction?: string;
    blockers?: string[];
    keyOutputs?: string[];
  };
  context?: {
    decisions?: string[];
    constraints?: string[];
    [key: string]: unknown;
  };
  links?: Array<{ label?: string; url?: string }>;
  file?: string;
  [key: string]: unknown;
};

export type TaskCardCompletionGuardReason = {
  code: "incomplete_steps" | "open_blockers";
  message: string;
};

export type TaskCardCompletionGuardResult =
  | {
      ok: true;
      taskId: string;
      currentRevision?: TaskBoardRevision;
      skipped?: boolean;
    }
  | {
      ok: false;
      taskId: string;
      currentRevision?: TaskBoardRevision;
      reasons: TaskCardCompletionGuardReason[];
    };

type PatchTaskCardResult =
  | {
      success: true;
      taskId: string;
      revision?: TaskBoardRevision;
      updatedFields: string[];
      statusChange?: { from?: string; to?: string };
    }
  | {
      success: false;
      taskId?: string;
      reason: string;
      errorCode?: "task_not_found" | "stale_task";
      currentRevision?: TaskBoardRevision;
    };

function normalizeTaskId(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeStringList(value: unknown, maxItems = 50): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }
    const trimmed = item.trim();
    if (!trimmed) {
      continue;
    }
    out.push(trimmed);
    if (out.length >= maxItems) {
      break;
    }
  }
  return out;
}

async function readTaskBoard(workspaceDir: string): Promise<{
  boardPath: string;
  board: TaskBoard;
} | null> {
  const boardPath = resolveTaskBoardPath(workspaceDir);
  let raw: string;
  try {
    raw = await fs.readFile(boardPath, "utf-8");
  } catch {
    return null;
  }
  try {
    return { boardPath, board: JSON.parse(raw) as TaskBoard };
  } catch {
    return null;
  }
}

function revisionsEqual(
  expected: string | number | undefined,
  current: TaskBoardRevision | undefined,
): boolean {
  if (expected == null) {
    return true;
  }
  if (current == null) {
    return false;
  }
  return String(expected) === String(current);
}

function valuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function writeTaskBoard(
  boardPath: string,
  board: TaskBoard,
  nowMs: number,
): Promise<{ success: boolean; revision?: TaskBoardRevision }> {
  const revision = bumpTaskBoardRevision(board, nowMs);
  const tmpPath = `${boardPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(tmpPath, `${JSON.stringify(board, null, 2)}\n`, "utf-8");
    await fs.rename(tmpPath, boardPath);
    return { success: true, revision };
  } catch {
    try {
      await fs.rm(tmpPath, { force: true });
    } catch {
      /* best-effort */
    }
    return { success: false };
  }
}

function ensureTaskCardStub(
  board: TaskBoard,
  params: {
    taskId: string;
    title?: string;
    nowIso: string;
  },
): TaskEntry {
  if (!board.tasks) {
    board.tasks = {};
  }
  const existing = board.tasks[params.taskId];
  if (existing) {
    return existing;
  }
  const stub: TaskEntry = {
    title: params.title?.trim() || params.taskId,
    status: "active",
    lane: "bot_current",
    goal: "",
    summary: "",
    steps: [],
    current_step: 0,
    blockers: [],
    progress: "0/0 steps done",
    context: { decisions: [], constraints: [] },
    links: [],
    created_at: params.nowIso,
    updated_at: params.nowIso,
  };
  board.tasks[params.taskId] = stub;
  return stub;
}

/**
 * Reads only the active task id from tasks.json lanes.bot_current[0].
 */
export async function resolveBoardActiveTaskId(workspaceDir: string): Promise<string | undefined> {
  const payload = await readTaskBoard(workspaceDir);
  if (!payload) {
    return undefined;
  }
  return normalizeTaskId(payload.board.lanes?.bot_current?.[0]);
}

/**
 * Reads the active task from tasks.json and returns a structured summary.
 * Returns null if no active task or tasks.json is missing.
 */
export async function resolveActiveTask(workspaceDir: string): Promise<ActiveTaskSummary | null> {
  const payload = await readTaskBoard(workspaceDir);
  if (!payload) {
    return null;
  }
  const { board } = payload;

  const botCurrent = board.lanes?.bot_current;
  if (!Array.isArray(botCurrent) || botCurrent.length === 0) {
    return null;
  }

  const taskId = normalizeTaskId(botCurrent[0]);
  if (!taskId) {
    return null;
  }

  const task = board.tasks?.[taskId];
  if (!task) {
    return null;
  }

  const steps = Array.isArray(task.steps) ? task.steps : [];
  const completedSteps = steps.filter((s) => s.status === "done" || s.checked);
  const remainingSteps = steps.filter((s) => s.status !== "done" && !s.checked);
  const currentIndex =
    typeof task.current_step === "number" ? task.current_step : completedSteps.length;
  const currentStep = steps[currentIndex];

  // Collect key outputs from completed steps and handoff
  const keyOutputs: string[] = [];
  for (const step of completedSteps) {
    if (step.output) {
      keyOutputs.push(`${step.id}: ${step.output}`);
    }
  }
  if (task.handoff?.keyOutputs) {
    keyOutputs.push(...task.handoff.keyOutputs);
  }
  const decisions = normalizeStringList(task.context?.decisions);
  const constraints = normalizeStringList(task.context?.constraints);
  const links = normalizeStringList(task.links?.map((link) => link?.url ?? link?.label ?? ""));
  const readiness = normalizeTaskReadiness(task);

  return {
    taskId,
    title: task.title ?? taskId,
    goal: task.goal ?? task.summary,
    totalSteps: steps.length,
    completedSteps: completedSteps.length,
    currentStepIndex: currentIndex,
    currentStepText: currentStep?.text,
    stepsCompleted: completedSteps.map(
      (s) => `[${s.id}] ${s.text}${s.output ? ` → ${s.output}` : ""}`,
    ),
    stepsRemaining: remainingSteps.map((s) => `[${s.id}] ${s.text}`),
    keyOutputs,
    blockers: readiness.unresolvedBlockers,
    resolvedBlockers: readiness.resolvedBlockers,
    canStart: readiness.canStart,
    nextRecommendedAction: readiness.nextRecommendedAction,
    nextAction: task.next_action ?? task.handoff?.nextAction,
    decisions,
    constraints,
    links,
  };
}

/**
 * Builds compaction instructions from the active task.
 * These tell Claude what progress to preserve during context summarization.
 */
export function buildTaskCompactionInstructions(task: ActiveTaskSummary): string {
  const lines: string[] = [];
  lines.push(`\n\nCRITICAL TASK CONTEXT — MUST PRESERVE IN SUMMARY:`);
  lines.push(`Task: "${task.title}" (${task.taskId})`);
  lines.push(`Progress: Step ${task.completedSteps} of ${task.totalSteps} completed`);

  if (task.goal) {
    lines.push(`Goal: ${task.goal}`);
  }

  if (task.stepsCompleted.length > 0) {
    lines.push(`\nCompleted steps (DO NOT lose these):`);
    for (const step of task.stepsCompleted) {
      lines.push(`  ✅ ${step}`);
    }
  }

  if (task.keyOutputs.length > 0) {
    lines.push(`\nKey outputs (MUST preserve):`);
    for (const output of task.keyOutputs) {
      lines.push(`  - ${output}`);
    }
  }

  if (task.currentStepText) {
    lines.push(`\nCurrent step: ${task.currentStepText}`);
  }

  if (task.nextAction) {
    lines.push(`Next action: ${task.nextAction}`);
  }

  if (!task.canStart) {
    lines.push(`Startability: blocked (${task.nextRecommendedAction})`);
  }

  if (task.stepsRemaining.length > 0) {
    lines.push(`\nRemaining steps:`);
    for (const step of task.stepsRemaining) {
      lines.push(`  ⬜ ${step}`);
    }
  }

  if (task.blockers.length > 0) {
    lines.push(`\nBlockers: ${task.blockers.join(", ")}`);
  }

  const decisions = task.decisions.slice(-5);
  if (decisions.length > 0) {
    lines.push(`\nRecent decisions (preserve rationale):`);
    for (const decision of decisions) {
      lines.push(`  - ${decision}`);
    }
  }

  const constraints = task.constraints.slice(0, 5);
  if (constraints.length > 0) {
    lines.push(`\nHard constraints (must remain true):`);
    for (const constraint of constraints) {
      lines.push(`  - ${constraint}`);
    }
  }

  const links = task.links.slice(0, 5);
  if (links.length > 0) {
    lines.push(`\nRelevant links:`);
    for (const link of links) {
      lines.push(`  - ${link}`);
    }
  }

  return lines.join("\n");
}

/**
 * Builds a bootstrap context string from the active task card.
 * This gets injected into the system prompt at session start so the
 * agent knows what task it's working on and where progress stands.
 */
export function buildTaskBootstrapContext(task: ActiveTaskSummary): string {
  const lines: string[] = [];
  lines.push(`# Active Task: ${task.title}`);
  lines.push(``);
  lines.push(`**Task ID:** ${task.taskId}`);
  lines.push(`**Progress:** Step ${task.completedSteps} of ${task.totalSteps}`);

  if (task.goal) {
    lines.push(`**Goal:** ${task.goal}`);
  }

  if (task.stepsCompleted.length > 0) {
    lines.push(``);
    lines.push(`## Completed Steps`);
    for (const step of task.stepsCompleted) {
      lines.push(`- ✅ ${step}`);
    }
  }

  if (task.keyOutputs.length > 0) {
    lines.push(``);
    lines.push(`## Key Outputs`);
    for (const output of task.keyOutputs) {
      lines.push(`- ${output}`);
    }
  }

  if (task.currentStepText) {
    lines.push(``);
    lines.push(`## Current Step`);
    lines.push(task.currentStepText);
  }

  if (task.nextAction) {
    lines.push(``);
    lines.push(`## Next Action`);
    lines.push(task.nextAction);
  }

  if (!task.canStart) {
    lines.push(``);
    lines.push(`## Startability`);
    lines.push(`blocked (${task.nextRecommendedAction})`);
  }

  if (task.stepsRemaining.length > 0) {
    lines.push(``);
    lines.push(`## Remaining Steps`);
    for (const step of task.stepsRemaining) {
      lines.push(`- ⬜ ${step}`);
    }
  }

  if (task.blockers.length > 0) {
    lines.push(``);
    lines.push(`## Blockers`);
    for (const blocker of task.blockers) {
      lines.push(`- ❌ ${blocker}`);
    }
  }

  const decisions = task.decisions.slice(-5);
  if (decisions.length > 0) {
    lines.push(``);
    lines.push(`## Recent Decisions`);
    for (const decision of decisions) {
      lines.push(`- ${decision}`);
    }
  }

  const constraints = task.constraints.slice(0, 5);
  if (constraints.length > 0) {
    lines.push(``);
    lines.push(`## Constraints`);
    for (const constraint of constraints) {
      lines.push(`- ${constraint}`);
    }
  }

  const links = task.links.slice(0, 5);
  if (links.length > 0) {
    lines.push(``);
    lines.push(`## Links`);
    for (const link of links) {
      lines.push(`- ${link}`);
    }
  }

  lines.push(``);
  lines.push(`---`);
  lines.push(`*Continue from the current step. Do not repeat completed steps.*`);

  return lines.join("\n");
}

/**
 * Updates the task card in tasks.json with current progress.
 * Called before compaction or session end to checkpoint progress.
 */
export async function checkpointActiveTask(params: {
  workspaceDir: string;
  taskId?: string;
  currentStepIndex?: number;
  stepOutputs?: Record<string, string>;
  nextAction?: string;
  handoffSummary?: string;
}): Promise<boolean> {
  return withTaskBoardLock({
    workspaceDir: params.workspaceDir,
    fn: async () => {
      const payload = await readTaskBoard(params.workspaceDir);
      if (!payload) {
        return false;
      }
      const { boardPath, board } = payload;

      const taskId =
        normalizeTaskId(params.taskId) ??
        normalizeTaskId(
          Array.isArray(board.lanes?.bot_current) ? board.lanes?.bot_current[0] : undefined,
        );
      if (!taskId) {
        return false;
      }

      const task = board.tasks?.[taskId];
      if (!task) {
        return false;
      }

      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();
      let dirty = false;

      // Update step statuses
      if (typeof params.currentStepIndex === "number" && Array.isArray(task.steps)) {
        for (let i = 0; i < task.steps.length; i++) {
          const step = task.steps[i];
          if (!step) {
            continue;
          }
          if (i < params.currentStepIndex) {
            if (step.status !== "done") {
              step.status = "done";
              dirty = true;
            }
            if (step.checked !== true) {
              step.checked = true;
              dirty = true;
            }
          } else if (i === params.currentStepIndex && step.status !== "in_progress") {
            step.status = "in_progress";
            dirty = true;
          }
        }
        if (task.current_step !== params.currentStepIndex) {
          task.current_step = params.currentStepIndex;
          dirty = true;
        }
      }

      // Update step outputs
      if (params.stepOutputs && Array.isArray(task.steps)) {
        for (const [stepId, output] of Object.entries(params.stepOutputs)) {
          const step = task.steps.find((entry) => entry.id === stepId);
          if (step && step.output !== output) {
            (step as TaskStep & { output?: string }).output = output;
            dirty = true;
          }
        }
      }

      // Update next action
      if (params.nextAction && task.next_action !== params.nextAction) {
        task.next_action = params.nextAction;
        dirty = true;
      }

      // Update handoff summary
      if (params.handoffSummary) {
        if (!task.handoff) {
          task.handoff = { whatIsDone: "", nextAction: "", blockers: [] };
        }
        if (task.handoff.whatIsDone !== params.handoffSummary) {
          task.handoff.whatIsDone = params.handoffSummary;
          dirty = true;
        }
      }

      // Update progress only when it actually changes.
      const completedCount = Array.isArray(task.steps)
        ? task.steps.filter((s) => s.status === "done" || s.checked).length
        : 0;
      const totalCount = Array.isArray(task.steps) ? task.steps.length : 0;
      const nextProgress = `${completedCount}/${totalCount} steps done`;
      if (task.progress !== nextProgress) {
        task.progress = nextProgress;
        dirty = true;
      }

      if (!dirty) {
        return true;
      }

      task.updated_at = nowIso;

      try {
        const write = await writeTaskBoard(boardPath, board, nowMs);
        if (!write.success) {
          throw new Error("atomic task-board write failed");
        }
        log.info("task checkpoint saved", {
          taskId,
          progress: task.progress,
          revision: write.revision,
        });
        return true;
      } catch (err) {
        log.warn(`task checkpoint failed: ${String(err)}`);
        return false;
      }
    },
  });
}

/**
 * Updates the `bot_current` lane in tasks.json to point at the given taskId.
 * If the task doesn't exist in tasks.json, it's still set as bot_current
 * (the task card may be created later).
 *
 * If `previousTaskId` is provided and the task exists, its lane is moved
 * to `bot_queue` so it's paused but not lost.
 */
export async function updateBotCurrentTask(params: {
  workspaceDir: string;
  taskId?: string;
  title?: string;
  previousTaskId?: string;
  previousStatus?: "paused" | "completed" | "archived";
}): Promise<boolean> {
  return withTaskBoardLock({
    workspaceDir: params.workspaceDir,
    fn: async () => {
      const payload = await readTaskBoard(params.workspaceDir);
      if (!payload) {
        return false;
      }
      const { boardPath, board } = payload;
      const nextTaskId = normalizeTaskId(params.taskId);
      const previousTaskId = normalizeTaskId(params.previousTaskId);
      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();
      let dirty = false;

      if (!board.lanes) {
        board.lanes = { bot_current: [] };
        dirty = true;
      }
      if (!Array.isArray(board.lanes.bot_current)) {
        board.lanes.bot_current = [];
        dirty = true;
      }
      if (!Array.isArray(board.lanes.bot_queue)) {
        board.lanes.bot_queue = [];
        dirty = true;
      }
      if (!board.tasks) {
        board.tasks = {};
        dirty = true;
      }

      // Move previous task out of bot_current if present
      if (previousTaskId && previousTaskId !== nextTaskId) {
        const prevIdx = board.lanes.bot_current?.indexOf(previousTaskId) ?? -1;
        if (prevIdx >= 0) {
          board.lanes.bot_current.splice(prevIdx, 1);
          dirty = true;
        }
        const prevQueueIdx = board.lanes.bot_queue.indexOf(previousTaskId);
        if (prevQueueIdx >= 0) {
          board.lanes.bot_queue.splice(prevQueueIdx, 1);
          dirty = true;
        }
        const previousStatus = params.previousStatus ?? "paused";
        if (previousStatus === "paused" && !board.lanes.bot_queue.includes(previousTaskId)) {
          board.lanes.bot_queue.push(previousTaskId);
          dirty = true;
        }
        const prevTask = board.tasks[previousTaskId];
        if (prevTask) {
          if (previousStatus && prevTask.status !== previousStatus) {
            prevTask.status = previousStatus;
            dirty = true;
          }
          if (prevTask.updated_at !== nowIso) {
            prevTask.updated_at = nowIso;
            dirty = true;
          }
        }
      }

      if (nextTaskId) {
        // Set new task as bot_current
        if (!valuesEqual(board.lanes.bot_current, [nextTaskId])) {
          board.lanes.bot_current = [nextTaskId];
          dirty = true;
        }

        // Remove new task from bot_queue if it was there
        const qIdx = board.lanes.bot_queue.indexOf(nextTaskId);
        if (qIdx >= 0) {
          board.lanes.bot_queue.splice(qIdx, 1);
          dirty = true;
        }

        // Ensure task card exists, then mark active.
        const taskExisted = Boolean(board.tasks[nextTaskId]);
        const newTask = ensureTaskCardStub(board, {
          taskId: nextTaskId,
          title: params.title,
          nowIso,
        });
        if (!taskExisted) {
          dirty = true;
        }
        if (newTask.status !== "active") {
          newTask.status = "active";
          dirty = true;
        }
        if (newTask.lane !== "bot_current") {
          newTask.lane = "bot_current";
          dirty = true;
        }
        if (newTask.updated_at !== nowIso) {
          newTask.updated_at = nowIso;
          dirty = true;
        }
      } else if ((board.lanes.bot_current?.length ?? 0) > 0) {
        board.lanes.bot_current = [];
        dirty = true;
      }

      if (!dirty) {
        return true;
      }

      try {
        const write = await writeTaskBoard(boardPath, board, nowMs);
        if (!write.success) {
          throw new Error("atomic task-board write failed");
        }
        log.info("bot_current updated", {
          taskId: nextTaskId ?? null,
          previousTaskId,
          revision: write.revision,
        });
        return true;
      } catch (err) {
        log.warn(`bot_current update failed: ${String(err)}`);
        return false;
      }
    },
  });
}

/**
 * Uses the task card as a lightweight completion gate so `/task completed`
 * can't silently ignore unfinished checklist work or known blockers.
 */
export async function evaluateTaskCardCompletionGuards(params: {
  workspaceDir: string;
  taskId: string;
}): Promise<TaskCardCompletionGuardResult> {
  return withTaskBoardLock({
    workspaceDir: params.workspaceDir,
    fn: async () => {
      const payload = await readTaskBoard(params.workspaceDir);
      if (!payload) {
        return { ok: true, taskId: params.taskId, skipped: true };
      }
      const { board } = payload;
      const currentRevision = resolveTaskBoardRevision(board);
      const taskId = normalizeTaskId(params.taskId);
      if (!taskId) {
        return { ok: true, taskId: params.taskId, currentRevision, skipped: true };
      }

      const task = board.tasks?.[taskId];
      if (!task) {
        return { ok: true, taskId, currentRevision, skipped: true };
      }

      const reasons: TaskCardCompletionGuardReason[] = [];
      const steps = Array.isArray(task.steps) ? task.steps : [];
      const incompleteSteps = steps.filter((step) => step.status !== "done" && !step.checked);
      if (incompleteSteps.length > 0) {
        reasons.push({
          code: "incomplete_steps",
          message:
            incompleteSteps.length === 1
              ? `1 step is still incomplete: ${incompleteSteps[0]?.text ?? incompleteSteps[0]?.id ?? "unnamed step"}`
              : `${incompleteSteps.length} steps are still incomplete.`,
        });
      }

      const readiness = normalizeTaskReadiness(task);
      const openBlockers = readiness.unresolvedBlockers;
      if (openBlockers.length > 0) {
        reasons.push({
          code: "open_blockers",
          message:
            openBlockers.length === 1
              ? `1 blocker is still open: ${openBlockers[0]}`
              : `${openBlockers.length} blockers are still open.`,
        });
      }

      if (reasons.length > 0) {
        return { ok: false, taskId, currentRevision, reasons };
      }
      return { ok: true, taskId, currentRevision };
    },
  });
}

/**
 * Flexible patch for the active task card in tasks.json.
 * Used when human feedback changes the plan mid-execution:
 * - Revise goal, add/remove/reorder steps, update context, blockers, etc.
 *
 * Only fields present in the patch are applied — everything else is preserved.
 * Completed steps (status "done") are never removed by a step replacement
 * unless explicitly included in the new steps array.
 */
export async function patchTaskCard(params: {
  workspaceDir: string;
  taskId?: string; // defaults to bot_current[0]
  expectedRevision?: string | number;
  patch: {
    title?: string;
    goal?: string;
    summary?: string;
    steps?: TaskStep[];
    next_action?: string;
    status?: string;
    blockers?: string[];
    context?: {
      decisions?: string[];
      constraints?: string[];
      [key: string]: unknown;
    };
    links?: Array<{ label?: string; url?: string }>;
    [key: string]: unknown;
  };
}): Promise<PatchTaskCardResult> {
  return withTaskBoardLock({
    workspaceDir: params.workspaceDir,
    fn: async () => {
      const boardPath = resolveTaskBoardPath(params.workspaceDir);

      let raw: string;
      try {
        raw = await fs.readFile(boardPath, "utf-8");
      } catch {
        return { success: false, reason: "tasks.json not found" };
      }

      let board: TaskBoard;
      try {
        board = JSON.parse(raw) as TaskBoard;
      } catch {
        return { success: false, reason: "tasks.json invalid JSON" };
      }

      const currentRevision = resolveTaskBoardRevision(board);
      if (!revisionsEqual(params.expectedRevision, currentRevision)) {
        return {
          success: false,
          errorCode: "stale_task",
          reason: "tasks.json changed before patch could be applied",
          currentRevision,
        };
      }

      // Resolve target task
      const taskId =
        params.taskId ??
        (Array.isArray(board.lanes?.bot_current) ? board.lanes.bot_current[0] : undefined);
      if (!taskId || typeof taskId !== "string") {
        return { success: false, reason: "no active task", currentRevision };
      }

      const task = board.tasks?.[taskId];
      if (!task) {
        return {
          success: false,
          taskId,
          errorCode: "task_not_found",
          reason: `task ${taskId} not found`,
          currentRevision,
        };
      }

      const { patch } = params;
      const previousStatus =
        typeof task.status === "string" && task.status.trim() ? task.status.trim() : undefined;
      const updatedFields: string[] = [];
      const markChanged = (field: string) => {
        if (!updatedFields.includes(field)) {
          updatedFields.push(field);
        }
      };

      const applyField = (field: keyof TaskEntry, value: unknown) => {
        const currentValue = task[field];
        if (!valuesEqual(currentValue, value)) {
          (task as Record<string, unknown>)[field] = value;
          markChanged(String(field));
        }
      };

      // Apply simple field patches
      if (patch.title !== undefined) {
        applyField("title", patch.title);
      }
      if (patch.goal !== undefined) {
        applyField("goal", patch.goal);
      }
      if (patch.summary !== undefined) {
        applyField("summary", patch.summary);
      }
      if (patch.next_action !== undefined) {
        applyField("next_action", patch.next_action);
      }
      if (patch.status !== undefined) {
        applyField("status", patch.status);
      }
      if (patch.blockers !== undefined) {
        applyField("blockers", patch.blockers);
      }
      if (patch.links !== undefined) {
        applyField("links", patch.links);
      }

      // Merge context (don't replace — merge keys).
      if (patch.context) {
        const nextContext = { ...task.context } as Record<string, unknown>;
        let contextChanged = false;
        for (const [key, value] of Object.entries(patch.context)) {
          if (!valuesEqual(nextContext[key], value)) {
            nextContext[key] = value;
            contextChanged = true;
          }
        }
        if (contextChanged) {
          task.context = nextContext;
          markChanged("context");
        }
      }

      // Steps replacement with completed-step preservation.
      if (Array.isArray(patch.steps)) {
        const oldSteps = Array.isArray(task.steps) ? task.steps : [];
        const completedMap = new Map<string, TaskStep>();
        for (const step of oldSteps) {
          if (step.status === "done" || step.checked) {
            completedMap.set(step.id, step);
          }
        }

        const mergedSteps: TaskStep[] = [];
        for (const newStep of patch.steps) {
          const completed = completedMap.get(newStep.id);
          if (completed) {
            mergedSteps.push({
              ...completed,
              text: newStep.text ?? completed.text,
            });
            completedMap.delete(newStep.id);
          } else {
            mergedSteps.push(newStep);
          }
        }

        const orphanedCompleted = [...completedMap.values()];
        if (orphanedCompleted.length > 0) {
          let insertIdx = 0;
          for (let i = mergedSteps.length - 1; i >= 0; i--) {
            if (mergedSteps[i]?.status === "done" || mergedSteps[i]?.checked) {
              insertIdx = i + 1;
              break;
            }
          }
          mergedSteps.splice(insertIdx, 0, ...orphanedCompleted);
        }

        if (!valuesEqual(task.steps, mergedSteps)) {
          task.steps = mergedSteps;
          markChanged("steps");
        }

        const firstPending = mergedSteps.findIndex(
          (step) => step.status !== "done" && !step.checked,
        );
        const nextCurrentStep = firstPending >= 0 ? firstPending : mergedSteps.length;
        if (task.current_step !== nextCurrentStep) {
          task.current_step = nextCurrentStep;
          markChanged("current_step");
        }
      }

      // Apply any extra fields from patch (future-proof).
      for (const [key, value] of Object.entries(patch)) {
        if (
          ![
            "title",
            "goal",
            "summary",
            "steps",
            "next_action",
            "status",
            "blockers",
            "context",
            "links",
          ].includes(key)
        ) {
          const currentValue = (task as Record<string, unknown>)[key];
          if (!valuesEqual(currentValue, value)) {
            (task as Record<string, unknown>)[key] = value;
            markChanged(key);
          }
        }
      }

      if (updatedFields.includes("steps") || updatedFields.includes("current_step")) {
        const steps = Array.isArray(task.steps) ? task.steps : [];
        const doneCount = steps.filter((step) => step.status === "done" || step.checked).length;
        const nextProgress = `${doneCount}/${steps.length} steps done`;
        if (task.progress !== nextProgress) {
          task.progress = nextProgress;
          markChanged("progress");
        }
      }

      if (updatedFields.length === 0) {
        return {
          success: true,
          taskId,
          revision: currentRevision,
          updatedFields: [],
        };
      }

      const nowMs = Date.now();
      task.updated_at = new Date(nowMs).toISOString();

      try {
        const write = await writeTaskBoard(boardPath, board, nowMs);
        if (!write.success) {
          throw new Error("atomic task-board write failed");
        }
        const nextStatus =
          typeof task.status === "string" && task.status.trim() ? task.status.trim() : undefined;
        log.info("task card patched", {
          taskId,
          patchKeys: Object.keys(patch),
          updatedFields,
          revision: write.revision,
        });
        return {
          success: true,
          taskId,
          revision: write.revision,
          updatedFields,
          statusChange:
            previousStatus !== nextStatus ? { from: previousStatus, to: nextStatus } : undefined,
        };
      } catch (err) {
        log.warn(`task card patch failed: ${String(err)}`);
        return { success: false, taskId, reason: String(err), currentRevision };
      }
    },
  });
}
