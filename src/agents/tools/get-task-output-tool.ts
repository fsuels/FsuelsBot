import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "./common.js";
import {
  GET_TASK_OUTPUT_TOOL_ALIASES,
  GET_TASK_OUTPUT_TOOL_NAME,
  isTerminalTaskStatus,
} from "../task-output-contract.js";
import { getTaskOutput, getTaskOutputSnapshot } from "../task-output.js";
import { jsonResult, readStringParam } from "./common.js";

const GetTaskOutputToolSchema = Type.Object({
  task_id: Type.Optional(
    Type.String({
      description: "Canonical background task id (exec session id or sub-agent run id).",
    }),
  ),
  taskId: Type.Optional(
    Type.String({
      description: "CamelCase alias for task_id.",
    }),
  ),
  block: Type.Optional(
    Type.Boolean({
      description: "Wait for terminal completion when true (default true).",
    }),
  ),
  timeout_ms: Type.Optional(
    Type.Number({
      minimum: 0,
      description: "Maximum wait time when block=true (default 30000).",
    }),
  ),
  timeoutMs: Type.Optional(
    Type.Number({
      minimum: 0,
      description: "CamelCase alias for timeout_ms.",
    }),
  ),
});

function readTaskId(params: Record<string, unknown>) {
  return (
    readStringParam(params, "task_id", { label: "task_id" }) ??
    readStringParam(params, "taskId", { label: "task_id" })
  );
}

function readTimeoutMs(params: Record<string, unknown>) {
  const raw =
    typeof params.timeout_ms === "number"
      ? params.timeout_ms
      : typeof params.timeoutMs === "number"
        ? params.timeoutMs
        : undefined;
  if (raw === undefined || !Number.isFinite(raw)) {
    return 30_000;
  }
  return Math.max(0, Math.floor(raw));
}

function buildWaitingUpdate(taskId: string) {
  const snapshot = getTaskOutputSnapshot(taskId);
  if (!snapshot || isTerminalTaskStatus(snapshot.status)) {
    return null;
  }
  return {
    content: [
      {
        type: "text",
        text: `Waiting for task ${taskId} to finish...`,
      },
    ],
    details: {
      type: "waiting_for_task",
      task_id: snapshot.task_id,
      task_type: snapshot.task_type,
      description: snapshot.description,
    },
  };
}

export function createGetTaskOutputTool(opts?: {
  name?: string;
  deprecatedAlias?: boolean;
}): AnyAgentTool {
  const name = opts?.name ?? GET_TASK_OUTPUT_TOOL_NAME;
  const deprecatedAlias = opts?.deprecatedAlias === true;
  return {
    label: "Task Output",
    name,
    description: deprecatedAlias
      ? `Deprecated alias for ${GET_TASK_OUTPUT_TOOL_NAME}. Prefer ${GET_TASK_OUTPUT_TOOL_NAME} or read the task's output_path directly.`
      : "Read structured output for a background shell or sub-agent task. Prefer reading output_path directly when you only need the artifact.",
    parameters: GetTaskOutputToolSchema,
    execute: async (_toolCallId, args, signal, onUpdate) => {
      const params = (args ?? {}) as Record<string, unknown>;
      const taskId = readTaskId(params);
      if (!taskId) {
        throw new Error("task_id required");
      }
      const block = typeof params.block === "boolean" ? params.block : true;
      if (block) {
        const waitingUpdate = buildWaitingUpdate(taskId);
        if (waitingUpdate) {
          onUpdate?.(waitingUpdate);
        }
      }
      const payload = await getTaskOutput({
        task_id: taskId,
        block,
        timeout_ms: readTimeoutMs(params),
        signal,
      });
      if (!deprecatedAlias) {
        return jsonResult(payload);
      }
      return jsonResult({
        ...payload,
        deprecation: {
          alias: name,
          canonical: GET_TASK_OUTPUT_TOOL_NAME,
          message: `${name} is deprecated. Prefer ${GET_TASK_OUTPUT_TOOL_NAME} or read the task's output_path directly.`,
        },
      });
    },
  };
}

export function createTaskOutputTools(): AnyAgentTool[] {
  return [
    createGetTaskOutputTool(),
    ...GET_TASK_OUTPUT_TOOL_ALIASES.map((alias) =>
      createGetTaskOutputTool({
        name: alias,
        deprecatedAlias: true,
      }),
    ),
  ];
}
