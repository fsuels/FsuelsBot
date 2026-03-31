import { Type } from "@sinclair/typebox";
import type { OpenClawConfig } from "../../config/config.js";
import type { AnyAgentTool } from "./common.js";
import {
  getTaskBoardTaskDetail,
  loadTaskBoardSnapshot,
  renderTaskBoardTaskDetail,
} from "../../infra/task-board-view.js";
import { defineOpenClawTool } from "../tool-contract.js";
import { createStructuredToolFailureResult } from "../tool-contracts.js";
import { readStringParam } from "./common.js";
import { resolveTaskToolContext, TaskBoardTaskDetailSchema } from "./tasks-shared.js";

const TaskGetToolSchema = Type.Object(
  {
    taskId: Type.String({
      minLength: 1,
      description: "Task id from tasks_list.",
    }),
  },
  { additionalProperties: false },
);

const TaskGetToolFailureSchema = Type.Object(
  {
    ok: Type.Literal(false),
    success: Type.Literal(false),
    found: Type.Literal(false),
    tool: Type.String(),
    code: Type.Literal("not_found"),
    error: Type.String(),
    message: Type.String(),
    taskId: Type.String(),
    knownTaskIds: Type.Array(Type.String()),
  },
  { additionalProperties: false },
);

const TaskGetToolOutputSchema = Type.Union([TaskBoardTaskDetailSchema, TaskGetToolFailureSchema]);

export function createTaskGetTool(opts?: {
  workspaceDir?: string;
  agentSessionKey?: string;
  config?: OpenClawConfig;
}): AnyAgentTool {
  return defineOpenClawTool({
    label: "Task Detail",
    name: "task_get",
    description:
      "Get the full normalized task card for a task id. Use this after tasks_list before acting on a task.",
    parameters: TaskGetToolSchema,
    inputSchema: TaskGetToolSchema,
    outputSchema: TaskGetToolOutputSchema,
    userFacingName: () => "Task Detail",
    isReadOnly: () => true,
    isConcurrencySafe: () => true,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const taskId = readStringParam(params, "taskId", { required: true });
      const { workspaceDir } = resolveTaskToolContext(opts);
      const { board, snapshot } = await loadTaskBoardSnapshot({ workspaceDir });
      const detail = getTaskBoardTaskDetail({
        board,
        snapshot,
        taskId,
      });

      if (!detail) {
        return createStructuredToolFailureResult({
          toolName: "task_get",
          code: "not_found",
          message:
            `Task ${taskId} was not found in the visible task board. ` +
            `Known task ids: ${snapshot.tasks.map((task) => task.id).join(", ") || "(none)"}`,
          details: {
            taskId,
            knownTaskIds: snapshot.tasks.map((task) => task.id),
          },
        });
      }

      return {
        content: [{ type: "text" as const, text: renderTaskBoardTaskDetail(detail) }],
        details: detail,
      };
    },
  });
}
