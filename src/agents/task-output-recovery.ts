import { getFinishedSession, getSession } from "./bash-process-registry.js";
import { getSubagentRun } from "./subagent-registry.js";
import {
  listTaskOutputArtifacts,
  readTaskOutputArtifact,
  readTaskOutputFromTranscript,
  writeTaskOutputArtifact,
} from "./task-output-artifacts.js";
import { isTerminalTaskStatus, type TaskOutput } from "./task-output-contract.js";

const STALE_SHELL_TASK_REASON =
  "Background shell session is no longer attached to this runtime. It may have been orphaned after a restart; rerun it if you still need the result.";

function normalizeMetadataValue(value: unknown): string | number | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return undefined;
}

function isOrphanedShellTask(task: TaskOutput): boolean {
  if (task.task_type !== "shell" || isTerminalTaskStatus(task.status)) {
    return false;
  }
  return !getSession(task.task_id) && !getFinishedSession(task.task_id);
}

function normalizeDurableTask(task: TaskOutput): TaskOutput {
  if (!isOrphanedShellTask(task)) {
    return task;
  }
  const metadata = {
    ...task.metadata,
    stale_runtime: true,
    stale_reason: "process_session_missing",
  };
  const nextTask: TaskOutput = {
    ...task,
    status: "error",
    error: task.error?.trim() || STALE_SHELL_TASK_REASON,
    awaiting_input: undefined,
    metadata,
  };
  if (task.output_path?.trim()) {
    writeTaskOutputArtifact(nextTask);
  }
  return nextTask;
}

export function readDurableTaskOutput(taskId: string): TaskOutput | null {
  const trimmedTaskId = taskId.trim();
  if (!trimmedTaskId) {
    return null;
  }
  const task = readTaskOutputArtifact(trimmedTaskId) ?? readTaskOutputFromTranscript(trimmedTaskId);
  if (!task) {
    return null;
  }
  return normalizeDurableTask(task);
}

export function listDurableTaskOutputs(): TaskOutput[] {
  return listTaskOutputArtifacts().map((task) => normalizeDurableTask(task));
}

export function getTaskOwnerSessionKey(task: TaskOutput): string | undefined {
  const metadata = task.metadata ?? {};
  const owner =
    normalizeMetadataValue(metadata.session_key) ??
    normalizeMetadataValue(metadata.requester_session_key);
  return typeof owner === "string" ? owner : undefined;
}

export function getTaskStartedAt(task: TaskOutput): number | undefined {
  const value = normalizeMetadataValue(task.metadata?.started_at);
  return typeof value === "number" ? value : undefined;
}

export function getTaskEndedAt(task: TaskOutput): number | undefined {
  const value = normalizeMetadataValue(task.metadata?.ended_at);
  return typeof value === "number" ? value : undefined;
}

export function getTaskParentTaskId(task: TaskOutput): string | undefined {
  const metadata = task.metadata ?? {};
  const parent =
    normalizeMetadataValue(metadata.parent_task_id) ??
    normalizeMetadataValue(metadata.source_task_id);
  return typeof parent === "string" ? parent : undefined;
}

export function hasLiveRuntimeTask(task: TaskOutput): boolean {
  if (task.task_type === "shell") {
    return Boolean(getSession(task.task_id) || getFinishedSession(task.task_id));
  }
  if (task.task_type === "agent") {
    return Boolean(getSubagentRun(task.task_id));
  }
  return false;
}
