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
};

type TaskBoard = {
  lanes?: {
    bot_current?: string[];
    [key: string]: unknown;
  };
  tasks?: Record<string, TaskEntry>;
  [key: string]: unknown;
};

type TaskEntry = {
  title?: string;
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

/**
 * Reads the active task from tasks.json and returns a structured summary.
 * Returns null if no active task or tasks.json is missing.
 */
export async function resolveActiveTask(workspaceDir: string): Promise<ActiveTaskSummary | null> {
  const boardPath = path.join(workspaceDir, "memory", "tasks.json");

  let raw: string;
  try {
    raw = await fs.readFile(boardPath, "utf-8");
  } catch {
    return null;
  }

  let board: TaskBoard;
  try {
    board = JSON.parse(raw) as TaskBoard;
  } catch {
    return null;
  }

  const botCurrent = board.lanes?.bot_current;
  if (!Array.isArray(botCurrent) || botCurrent.length === 0) {
    return null;
  }

  const taskId = botCurrent[0];
  if (typeof taskId !== "string" || !taskId.trim()) {
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
  currentStepIndex?: number;
  stepOutputs?: Record<string, string>;
  nextAction?: string;
  handoffSummary?: string;
}): Promise<boolean> {
  const boardPath = path.join(params.workspaceDir, "memory", "tasks.json");

  let raw: string;
  try {
    raw = await fs.readFile(boardPath, "utf-8");
  } catch {
    return false;
  }

  let board: TaskBoard;
  try {
    board = JSON.parse(raw) as TaskBoard;
  } catch {
    return false;
  }

  const botCurrent = board.lanes?.bot_current;
  if (!Array.isArray(botCurrent) || botCurrent.length === 0) {
    return false;
  }

  const taskId = botCurrent[0];
  if (typeof taskId !== "string") {
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

  // Atomic write
  const tmpPath = `${boardPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(tmpPath, `${JSON.stringify(board, null, 2)}\n`, "utf-8");
    await fs.rename(tmpPath, boardPath);
    log.info("task checkpoint saved", {
      taskId,
      progress: task.progress,
    });
    return true;
  } catch (err) {
    try {
      await fs.rm(tmpPath, { force: true });
    } catch {
      /* best-effort */
    }
    log.warn(`task checkpoint failed: ${err}`);
    return false;
  }
}
