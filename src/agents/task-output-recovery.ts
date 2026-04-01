import fs from "node:fs";
import { getFinishedSession, getSession } from "./bash-process-registry.js";
import { getSubagentRun, STALE_SUBAGENT_RUNTIME_REASON } from "./subagent-registry.js";
import {
  listTaskOutputArtifacts,
  readTaskOutputArtifact,
  readTaskOutputArtifactDetailed,
  readTaskOutputFromTranscript,
  readTaskOutputFromTranscriptDetailed,
  resolveTaskOutputPath,
  resolveTaskTranscriptPath,
  writeTaskOutputArtifact,
} from "./task-output-artifacts.js";
import { isTerminalTaskStatus, type TaskOutput } from "./task-output-contract.js";

const STALE_SHELL_TASK_REASON =
  "Background shell session is no longer attached to this runtime. It may have been orphaned after a restart; rerun it if you still need the result.";
const TASK_OUTPUT_TYPES = ["shell", "agent", "remote_agent"] as const;

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

function isOrphanedSubagentTask(task: TaskOutput): boolean {
  if (task.task_type !== "agent" || isTerminalTaskStatus(task.status)) {
    return false;
  }
  return !getSubagentRun(task.task_id);
}

function normalizeDurableTask(task: TaskOutput): TaskOutput {
  if (!isOrphanedShellTask(task) && !isOrphanedSubagentTask(task)) {
    return task;
  }
  const metadata = {
    ...task.metadata,
    stale_runtime: true,
    stale_reason:
      task.task_type === "agent" ? "subagent_runtime_missing" : "process_session_missing",
  };
  const nextTask: TaskOutput = {
    ...task,
    status: "error",
    error:
      task.error?.trim() ||
      (task.task_type === "agent" ? STALE_SUBAGENT_RUNTIME_REASON : STALE_SHELL_TASK_REASON),
    awaiting_input: undefined,
    metadata,
  };
  if (task.output_path?.trim()) {
    writeTaskOutputArtifact(nextTask);
  }
  return nextTask;
}

function tryLstat(pathname: string) {
  try {
    return fs.lstatSync(pathname);
  } catch {
    return null;
  }
}

function buildDurableReadFailureTask(params: {
  taskId: string;
  taskType: string;
  kind: "output" | "transcript";
  pathname: string;
  reason: string;
}): TaskOutput {
  return {
    task_id: params.taskId,
    task_type: params.taskType,
    status: "error",
    description: "Persisted task output unavailable",
    output_path: params.kind === "output" ? params.pathname : undefined,
    transcript_path: params.kind === "transcript" ? params.pathname : undefined,
    error:
      `Persisted task ${params.kind} exists but could not be read at ${params.pathname}. ` +
      params.reason,
    metadata: {
      durable_read_failure: true,
      durable_read_failure_kind: params.kind,
      durable_read_failure_path: params.pathname,
      durable_read_failure_reason: params.reason,
    },
  };
}

function detectDurableReadFailure(
  taskId: string,
  env: NodeJS.ProcessEnv = process.env,
): TaskOutput | null {
  const outputDiagnostic = readTaskOutputArtifactDetailed(taskId, env).diagnostic;
  if (outputDiagnostic) {
    return buildDurableReadFailureTask({
      taskId,
      taskType: outputDiagnostic.taskType,
      kind: outputDiagnostic.kind,
      pathname: outputDiagnostic.path,
      reason: outputDiagnostic.error,
    });
  }

  const transcriptDiagnostic = readTaskOutputFromTranscriptDetailed(taskId, env).diagnostic;
  if (transcriptDiagnostic) {
    return buildDurableReadFailureTask({
      taskId,
      taskType: transcriptDiagnostic.taskType,
      kind: transcriptDiagnostic.kind,
      pathname: transcriptDiagnostic.path,
      reason: transcriptDiagnostic.error,
    });
  }

  for (const taskType of TASK_OUTPUT_TYPES) {
    const outputPath = resolveTaskOutputPath({ taskId, taskType, env });
    if (tryLstat(outputPath)) {
      return buildDurableReadFailureTask({
        taskId,
        taskType,
        kind: "output",
        pathname: outputPath,
        reason: "artifact exists but could not be decoded",
      });
    }
    const transcriptPath = resolveTaskTranscriptPath({ taskId, taskType, env });
    if (tryLstat(transcriptPath)) {
      return buildDurableReadFailureTask({
        taskId,
        taskType,
        kind: "transcript",
        pathname: transcriptPath,
        reason: "transcript exists but could not be replayed",
      });
    }
  }

  return null;
}

export function readDurableTaskOutput(taskId: string): TaskOutput | null {
  const trimmedTaskId = taskId.trim();
  if (!trimmedTaskId) {
    return null;
  }
  const task = readTaskOutputArtifact(trimmedTaskId) ?? readTaskOutputFromTranscript(trimmedTaskId);
  if (!task) {
    return detectDurableReadFailure(trimmedTaskId);
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
