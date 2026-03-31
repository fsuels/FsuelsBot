import { sleepWithAbort } from "../infra/backoff.js";
import {
  buildTaskOutputFromFinishedSession,
  buildTaskOutputFromProcessSession,
  getFinishedSession,
  getSession,
  setSessionNotified,
  waitForSessionTerminal,
} from "./bash-process-registry.js";
import {
  buildTaskOutputFromSubagentRun,
  getSubagentRun,
  setSubagentRunFinalText,
  setSubagentRunNotified,
  waitForSubagentTerminal,
} from "./subagent-registry.js";
import { setTaskOutputArtifactNotified } from "./task-output-artifacts.js";
import {
  TASK_OUTPUT_WAIT_BACKOFF_MS,
  isTerminalTaskStatus,
  type TaskOutput,
  type TaskOutputRetrieval,
} from "./task-output-contract.js";
import { readDurableTaskOutput } from "./task-output-recovery.js";
import { readLatestAssistantReply } from "./tools/agent-step.js";

function getShellTaskOutput(taskId: string): TaskOutput | null {
  const running = getSession(taskId);
  if (running?.backgrounded) {
    return buildTaskOutputFromProcessSession(running);
  }
  const finished = getFinishedSession(taskId);
  if (finished) {
    return buildTaskOutputFromFinishedSession(finished);
  }
  return null;
}

async function ensureAgentFinalText(task: TaskOutput, signal?: AbortSignal): Promise<TaskOutput> {
  if (task.task_type !== "agent" || !isTerminalTaskStatus(task.status) || task.final_text?.trim()) {
    return task;
  }
  const entry = getSubagentRun(task.task_id);
  if (!entry) {
    return task;
  }
  const delays = [0, ...TASK_OUTPUT_WAIT_BACKOFF_MS];
  for (const delayMs of delays) {
    if (delayMs > 0) {
      try {
        await sleepWithAbort(delayMs, signal);
      } catch {
        return getTaskOutputSnapshot(task.task_id) ?? task;
      }
    }
    const latest = await readLatestAssistantReply({ sessionKey: entry.childSessionKey }).catch(
      () => undefined,
    );
    if (!latest?.trim()) {
      continue;
    }
    setSubagentRunFinalText(task.task_id, latest);
    return getTaskOutputSnapshot(task.task_id) ?? task;
  }
  return getTaskOutputSnapshot(task.task_id) ?? task;
}

export function getTaskOutputSnapshot(taskId: string): TaskOutput | null {
  const trimmed = taskId.trim();
  if (!trimmed) {
    return null;
  }
  const shell = getShellTaskOutput(trimmed);
  if (shell) {
    return shell;
  }
  const subagent = getSubagentRun(trimmed);
  if (subagent) {
    return buildTaskOutputFromSubagentRun(subagent);
  }
  return readDurableTaskOutput(trimmed);
}

function markTaskNotified(taskId: string) {
  if (setSessionNotified(taskId, true)) {
    return true;
  }
  if (setSubagentRunNotified(taskId, true)) {
    return true;
  }
  return setTaskOutputArtifactNotified(taskId, true);
}

async function waitForTaskWithBackoff(params: {
  taskId: string;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<TaskOutput | null> {
  const deadline = Date.now() + Math.max(0, params.timeoutMs);
  let attempt = 0;
  while (Date.now() < deadline) {
    const snapshot = getTaskOutputSnapshot(params.taskId);
    if (!snapshot) {
      return null;
    }
    if (isTerminalTaskStatus(snapshot.status)) {
      return snapshot;
    }
    const delayMs =
      TASK_OUTPUT_WAIT_BACKOFF_MS[Math.min(attempt, TASK_OUTPUT_WAIT_BACKOFF_MS.length - 1)] ??
      TASK_OUTPUT_WAIT_BACKOFF_MS[TASK_OUTPUT_WAIT_BACKOFF_MS.length - 1] ??
      1000;
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      break;
    }
    try {
      await sleepWithAbort(Math.min(delayMs, remainingMs), params.signal);
    } catch {
      return getTaskOutputSnapshot(params.taskId);
    }
    attempt += 1;
  }
  return getTaskOutputSnapshot(params.taskId);
}

async function waitForTaskTerminal(params: {
  task: TaskOutput;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<TaskOutput | null> {
  if (params.task.task_type === "shell") {
    await waitForSessionTerminal({
      id: params.task.task_id,
      timeoutMs: params.timeoutMs,
      signal: params.signal,
    });
    return getTaskOutputSnapshot(params.task.task_id);
  }
  if (params.task.task_type === "agent") {
    await waitForSubagentTerminal({
      runId: params.task.task_id,
      timeoutMs: params.timeoutMs,
      signal: params.signal,
    });
    return await ensureAgentFinalText(
      getTaskOutputSnapshot(params.task.task_id) ?? params.task,
      params.signal,
    );
  }
  return await waitForTaskWithBackoff({
    taskId: params.task.task_id,
    timeoutMs: params.timeoutMs,
    signal: params.signal,
  });
}

export async function getTaskOutput(params: {
  task_id: string;
  block?: boolean;
  timeout_ms?: number;
  signal?: AbortSignal;
}): Promise<TaskOutputRetrieval> {
  const taskId = params.task_id.trim();
  if (!taskId) {
    return {
      retrieval_status: "not_found",
      task: null,
    };
  }

  let task = getTaskOutputSnapshot(taskId);
  if (!task) {
    return {
      retrieval_status: "not_found",
      task: null,
    };
  }
  task = await ensureAgentFinalText(task, params.signal);

  const block = params.block !== false;
  if (!block) {
    if (isTerminalTaskStatus(task.status)) {
      markTaskNotified(taskId);
      return {
        retrieval_status: "success",
        task: getTaskOutputSnapshot(taskId) ?? task,
      };
    }
    return {
      retrieval_status: "not_ready",
      task,
    };
  }

  if (isTerminalTaskStatus(task.status)) {
    markTaskNotified(taskId);
    return {
      retrieval_status: "success",
      task: getTaskOutputSnapshot(taskId) ?? task,
    };
  }

  const timeoutMs =
    typeof params.timeout_ms === "number" && Number.isFinite(params.timeout_ms)
      ? Math.max(0, Math.floor(params.timeout_ms))
      : 30_000;
  const waited = await waitForTaskTerminal({
    task,
    timeoutMs,
    signal: params.signal,
  });
  if (params.signal?.aborted) {
    return {
      retrieval_status: "not_ready",
      task: waited ?? getTaskOutputSnapshot(taskId),
    };
  }
  if (!waited) {
    return {
      retrieval_status: "timeout",
      task: getTaskOutputSnapshot(taskId),
    };
  }
  if (isTerminalTaskStatus(waited.status)) {
    markTaskNotified(taskId);
    return {
      retrieval_status: "success",
      task: getTaskOutputSnapshot(taskId) ?? waited,
    };
  }
  return {
    retrieval_status: "timeout",
    task: waited,
  };
}
