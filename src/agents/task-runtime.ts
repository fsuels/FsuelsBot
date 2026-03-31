import {
  buildTaskOutputFromFinishedSession,
  buildTaskOutputFromProcessSession,
  getFinishedSession,
  getSession,
  listFinishedSessions,
  listRunningSessions,
  markExited,
  type FinishedSession,
  type ProcessSession,
} from "./bash-process-registry.js";
import { killSession } from "./bash-tools.shared.js";
import {
  buildTaskOutputFromSubagentRun,
  getSubagentRun,
  listSubagentRuns,
  type SubagentRunRecord,
} from "./subagent-registry.js";
import { readTaskOutputArtifact } from "./task-output-artifacts.js";
import { isTerminalTaskStatus, type TaskOutput } from "./task-output-contract.js";

export type RuntimeTask = TaskOutput & {
  started_at?: number;
  ended_at?: number;
  is_backgrounded: boolean;
  parent_task_id?: string;
};

export type StopRuntimeTaskErrorCode = "not_found" | "not_running" | "unsupported_type";

export type StopRuntimeTaskResult =
  | { ok: true; task: RuntimeTask }
  | { ok: false; code: StopRuntimeTaskErrorCode; task?: RuntimeTask };

function buildRuntimeTaskFromProcessSession(
  session: ProcessSession | FinishedSession,
  output: TaskOutput,
): RuntimeTask {
  return {
    ...output,
    started_at: session.startedAt,
    ended_at: "endedAt" in session ? session.endedAt : undefined,
    is_backgrounded: true,
  };
}

function buildRuntimeTaskFromSubagentRun(entry: SubagentRunRecord): RuntimeTask {
  return {
    ...buildTaskOutputFromSubagentRun(entry),
    started_at: entry.startedAt ?? entry.createdAt,
    ended_at: entry.endedAt,
    is_backgrounded: true,
    parent_task_id: entry.sourceTaskId,
  };
}

export function getRuntimeTask(taskId: string): RuntimeTask | null {
  const trimmed = taskId.trim();
  if (!trimmed) {
    return null;
  }
  const session = getSession(trimmed);
  if (session?.backgrounded) {
    return buildRuntimeTaskFromProcessSession(session, buildTaskOutputFromProcessSession(session));
  }
  const finished = getFinishedSession(trimmed);
  if (finished) {
    return buildRuntimeTaskFromProcessSession(
      finished,
      buildTaskOutputFromFinishedSession(finished),
    );
  }
  const subagent = getSubagentRun(trimmed);
  if (subagent) {
    return buildRuntimeTaskFromSubagentRun(subagent);
  }
  const artifact = readTaskOutputArtifact(trimmed);
  if (!artifact) {
    return null;
  }
  return {
    ...artifact,
    is_backgrounded: true,
  };
}

export function listRuntimeTasks(params?: { requesterSessionKey?: string }): RuntimeTask[] {
  const requesterSessionKey = params?.requesterSessionKey?.trim();
  const tasks: RuntimeTask[] = [];

  for (const session of listRunningSessions()) {
    if (requesterSessionKey && session.sessionKey !== requesterSessionKey) {
      continue;
    }
    tasks.push(
      buildRuntimeTaskFromProcessSession(session, buildTaskOutputFromProcessSession(session)),
    );
  }

  for (const session of listFinishedSessions()) {
    if (requesterSessionKey && session.sessionKey !== requesterSessionKey) {
      continue;
    }
    tasks.push(
      buildRuntimeTaskFromProcessSession(session, buildTaskOutputFromFinishedSession(session)),
    );
  }

  for (const run of listSubagentRuns()) {
    if (requesterSessionKey && run.requesterSessionKey !== requesterSessionKey) {
      continue;
    }
    tasks.push(buildRuntimeTaskFromSubagentRun(run));
  }

  return tasks.toSorted((a, b) => {
    const aTime = a.started_at ?? a.ended_at ?? 0;
    const bTime = b.started_at ?? b.ended_at ?? 0;
    return bTime - aTime;
  });
}

export function listActionableRuntimeTaskIds(params: { requesterSessionKey: string }): string[] {
  return listRuntimeTasks({ requesterSessionKey: params.requesterSessionKey })
    .filter(
      (task) =>
        task.notified !== true &&
        (isTerminalTaskStatus(task.status) || task.status === "awaiting_input"),
    )
    .map((task) => task.task_id);
}

export function stopRuntimeTask(taskId: string, reason?: string): StopRuntimeTaskResult {
  const trimmed = taskId.trim();
  if (!trimmed) {
    return { ok: false, code: "not_found" };
  }

  const runningShell = getSession(trimmed);
  if (runningShell?.backgrounded) {
    killSession(runningShell);
    markExited(runningShell, null, "SIGKILL", "failed", {
      terminalReason: "cancelled",
      error: reason ?? "Task stopped by user request.",
    });
    const task = getRuntimeTask(trimmed);
    if (!task) {
      return { ok: false, code: "not_running" };
    }
    return { ok: true, task };
  }

  const subagent = getSubagentRun(trimmed);
  if (subagent) {
    const task = buildRuntimeTaskFromSubagentRun(subagent);
    if (isTerminalTaskStatus(task.status)) {
      return { ok: false, code: "not_running", task };
    }
    return { ok: false, code: "unsupported_type", task };
  }

  const finishedShell = getFinishedSession(trimmed);
  if (finishedShell) {
    return {
      ok: false,
      code: "not_running",
      task: buildRuntimeTaskFromProcessSession(
        finishedShell,
        buildTaskOutputFromFinishedSession(finishedShell),
      ),
    };
  }

  const artifact = readTaskOutputArtifact(trimmed);
  if (artifact) {
    return {
      ok: false,
      code: isTerminalTaskStatus(artifact.status) ? "not_running" : "unsupported_type",
      task: {
        ...artifact,
        is_backgrounded: true,
      },
    };
  }

  return { ok: false, code: "not_found" };
}
