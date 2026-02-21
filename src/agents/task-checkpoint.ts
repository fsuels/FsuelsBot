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
import path from "node:path";
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
  nextAction?: string;
  decisions: string[];
  constraints: string[];
  links: string[];
};

type TaskBoard = {
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

const TASK_BOARD_REL_PATH = path.join("memory", "tasks.json");

function resolveTaskBoardPath(workspaceDir: string): string {
  return path.join(workspaceDir, TASK_BOARD_REL_PATH);
}

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

async function writeTaskBoard(boardPath: string, board: TaskBoard): Promise<boolean> {
  const tmpPath = `${boardPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(tmpPath, `${JSON.stringify(board, null, 2)}\n`, "utf-8");
    await fs.rename(tmpPath, boardPath);
    return true;
  } catch {
    try {
      await fs.rm(tmpPath, { force: true });
    } catch {
      /* best-effort */
    }
    return false;
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
    blockers: Array.isArray(task.blockers) ? task.blockers : [],
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

  // Update step statuses
  if (typeof params.currentStepIndex === "number" && Array.isArray(task.steps)) {
    for (let i = 0; i < task.steps.length; i++) {
      if (i < params.currentStepIndex) {
        task.steps[i].status = "done";
        task.steps[i].checked = true;
      } else if (i === params.currentStepIndex) {
        task.steps[i].status = "in_progress";
      }
    }
    task.current_step = params.currentStepIndex;
  }

  // Update step outputs
  if (params.stepOutputs && Array.isArray(task.steps)) {
    for (const [stepId, output] of Object.entries(params.stepOutputs)) {
      const step = task.steps.find((s) => s.id === stepId);
      if (step) {
        (step as TaskStep & { output?: string }).output = output;
      }
    }
  }

  // Update next action
  if (params.nextAction) {
    task.next_action = params.nextAction;
  }

  // Update handoff summary
  if (params.handoffSummary) {
    if (!task.handoff) {
      task.handoff = { whatIsDone: "", nextAction: "", blockers: [] };
    }
    task.handoff.whatIsDone = params.handoffSummary;
  }

  // Write updated progress
  const completedCount = Array.isArray(task.steps)
    ? task.steps.filter((s) => s.status === "done" || s.checked).length
    : 0;
  const totalCount = Array.isArray(task.steps) ? task.steps.length : 0;
  task.progress = `${completedCount}/${totalCount} steps done`;
  task.updated_at = new Date().toISOString();

  board.updated_at = new Date().toISOString();

  try {
    if (!(await writeTaskBoard(boardPath, board))) {
      throw new Error("atomic task-board write failed");
    }
    log.info("task checkpoint saved", {
      taskId,
      progress: task.progress,
    });
    return true;
  } catch (err) {
    log.warn(`task checkpoint failed: ${err}`);
    return false;
  }
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
  const payload = await readTaskBoard(params.workspaceDir);
  if (!payload) {
    return false;
  }
  const { boardPath, board } = payload;
  const nextTaskId = normalizeTaskId(params.taskId);
  const previousTaskId = normalizeTaskId(params.previousTaskId);
  const nowIso = new Date().toISOString();

  if (!board.lanes) {
    board.lanes = { bot_current: [] };
  }
  if (!Array.isArray(board.lanes.bot_current)) {
    board.lanes.bot_current = [];
  }
  if (!Array.isArray(board.lanes.bot_queue)) {
    board.lanes.bot_queue = [];
  }
  if (!board.tasks) {
    board.tasks = {};
  }

  // Move previous task out of bot_current if present
  if (previousTaskId && previousTaskId !== nextTaskId) {
    const prevIdx = board.lanes.bot_current?.indexOf(previousTaskId) ?? -1;
    if (prevIdx >= 0) {
      board.lanes.bot_current!.splice(prevIdx, 1);
    }
    const prevQueueIdx = board.lanes.bot_queue.indexOf(previousTaskId);
    if (prevQueueIdx >= 0) {
      board.lanes.bot_queue.splice(prevQueueIdx, 1);
    }
    const previousStatus = params.previousStatus ?? "paused";
    if (previousStatus === "paused" && !board.lanes.bot_queue.includes(previousTaskId)) {
      board.lanes.bot_queue.push(previousTaskId);
    }
    const prevTask = board.tasks[previousTaskId];
    if (prevTask) {
      if (previousStatus) {
        prevTask.status = previousStatus;
      }
      prevTask.updated_at = nowIso;
    }
  }

  if (nextTaskId) {
    // Set new task as bot_current
    board.lanes.bot_current = [nextTaskId];

    // Remove new task from bot_queue if it was there
    const qIdx = board.lanes.bot_queue.indexOf(nextTaskId);
    if (qIdx >= 0) {
      board.lanes.bot_queue!.splice(qIdx, 1);
    }

    // Ensure task card exists, then mark active.
    const newTask = ensureTaskCardStub(board, {
      taskId: nextTaskId,
      title: params.title,
      nowIso,
    });
    newTask.status = "active";
    newTask.lane = "bot_current";
    newTask.updated_at = nowIso;
  } else {
    board.lanes.bot_current = [];
  }

  board.updated_at = nowIso;

  try {
    if (!(await writeTaskBoard(boardPath, board))) {
      throw new Error("atomic task-board write failed");
    }
    log.info("bot_current updated", {
      taskId: nextTaskId ?? null,
      previousTaskId,
    });
    return true;
  } catch (err) {
    log.warn(`bot_current update failed: ${err}`);
    return false;
  }
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
  patch: {
    title?: string;
    goal?: string;
    summary?: string;
    steps?: TaskStep[];
    next_action?: string;
    blockers?: string[];
    context?: {
      decisions?: string[];
      constraints?: string[];
      [key: string]: unknown;
    };
    links?: Array<{ label?: string; url?: string }>;
    [key: string]: unknown;
  };
}): Promise<{ success: boolean; taskId?: string; reason?: string }> {
  const boardPath = path.join(params.workspaceDir, "memory", "tasks.json");

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

  // Resolve target task
  const taskId =
    params.taskId ??
    (Array.isArray(board.lanes?.bot_current) ? board.lanes.bot_current[0] : undefined);
  if (!taskId || typeof taskId !== "string") {
    return { success: false, reason: "no active task" };
  }

  const task = board.tasks?.[taskId];
  if (!task) {
    return { success: false, taskId, reason: `task ${taskId} not found` };
  }

  const { patch } = params;

  // Apply simple field patches
  if (patch.title !== undefined) {
    task.title = patch.title;
  }
  if (patch.goal !== undefined) {
    task.goal = patch.goal;
  }
  if (patch.summary !== undefined) {
    task.summary = patch.summary;
  }
  if (patch.next_action !== undefined) {
    task.next_action = patch.next_action;
  }
  if (patch.blockers !== undefined) {
    task.blockers = patch.blockers;
  }
  if (patch.links !== undefined) {
    task.links = patch.links;
  }

  // Merge context (don't replace — merge keys)
  if (patch.context) {
    if (!task.context) {
      task.context = {};
    }
    for (const [key, value] of Object.entries(patch.context)) {
      (task.context as Record<string, unknown>)[key] = value;
    }
  }

  // Steps replacement with completed-step preservation
  if (Array.isArray(patch.steps)) {
    const oldSteps = Array.isArray(task.steps) ? task.steps : [];
    const completedMap = new Map<string, TaskStep>();
    for (const step of oldSteps) {
      if (step.status === "done" || step.checked) {
        completedMap.set(step.id, step);
      }
    }

    // Merge: for each new step, if a completed version exists, keep the completed state
    const mergedSteps: TaskStep[] = [];
    for (const newStep of patch.steps) {
      const completed = completedMap.get(newStep.id);
      if (completed) {
        // Keep completed status + output, but use new text if changed
        mergedSteps.push({
          ...completed,
          text: newStep.text ?? completed.text,
        });
        completedMap.delete(newStep.id);
      } else {
        mergedSteps.push(newStep);
      }
    }

    // Prepend any completed steps that were removed from the new plan
    // (so progress is NEVER lost)
    const orphanedCompleted = [...completedMap.values()];
    if (orphanedCompleted.length > 0) {
      // Find insertion point: after last completed step in merged list
      let insertIdx = 0;
      for (let i = mergedSteps.length - 1; i >= 0; i--) {
        if (mergedSteps[i].status === "done" || mergedSteps[i].checked) {
          insertIdx = i + 1;
          break;
        }
      }
      mergedSteps.splice(insertIdx, 0, ...orphanedCompleted);
    }

    task.steps = mergedSteps;

    // Update current_step to first non-done step
    const firstPending = mergedSteps.findIndex((s) => s.status !== "done" && !s.checked);
    task.current_step = firstPending >= 0 ? firstPending : mergedSteps.length;
  }

  // Apply any extra fields from patch (future-proof)
  for (const [key, value] of Object.entries(patch)) {
    if (
      ![
        "title",
        "goal",
        "summary",
        "steps",
        "next_action",
        "blockers",
        "context",
        "links",
      ].includes(key)
    ) {
      (task as Record<string, unknown>)[key] = value;
    }
  }

  // Update progress string
  const steps = Array.isArray(task.steps) ? task.steps : [];
  const doneCount = steps.filter((s) => s.status === "done" || s.checked).length;
  task.progress = `${doneCount}/${steps.length} steps done`;
  task.updated_at = new Date().toISOString();
  board.updated_at = new Date().toISOString();

  // Atomic write
  const tmpPath = `${boardPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(tmpPath, `${JSON.stringify(board, null, 2)}\n`, "utf-8");
    await fs.rename(tmpPath, boardPath);
    log.info("task card patched", { taskId, patchKeys: Object.keys(patch) });
    return { success: true, taskId };
  } catch (err) {
    try {
      await fs.rm(tmpPath, { force: true });
    } catch {
      /* best-effort */
    }
    log.warn(`task card patch failed: ${err}`);
    return { success: false, taskId, reason: String(err) };
  }
}
