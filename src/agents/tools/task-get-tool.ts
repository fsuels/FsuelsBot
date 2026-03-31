import { Type } from "@sinclair/typebox";
import type { OpenClawConfig } from "../../config/config.js";
import type { AnyAgentTool } from "./common.js";
import {
  getTaskBoardTaskDetail,
  loadTaskBoardSnapshot,
  renderTaskBoardTaskDetail,
} from "../../infra/task-board-view.js";
import { readStringParam } from "./common.js";
import { resolveTaskToolContext } from "./tasks-shared.js";

const TaskGetToolSchema = Type.Object(
  {
    taskId: Type.String({
      minLength: 1,
      description: "Task id from tasks_list.",
    }),
  },
  { additionalProperties: false },
);

export function createTaskGetTool(opts?: {
  workspaceDir?: string;
  agentSessionKey?: string;
  config?: OpenClawConfig;
}): AnyAgentTool {
  return {
    label: "Task Detail",
    name: "task_get",
    description:
      "Get the full normalized task card for a task id. Use this after tasks_list before acting on a task.",
    parameters: TaskGetToolSchema,
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
        const knownTaskIds = snapshot.tasks.map((task) => task.id);
        return {
          content: [
            {
              type: "text" as const,
              text:
                `Task ${taskId} was not found in the visible task board. ` +
                `Known task ids: ${knownTaskIds.join(", ") || "(none)"}`,
            },
          ],
          details: {
            ok: false,
            success: false,
            found: false,
            tool: "task_get",
            code: "not_found",
            taskId,
            knownTaskIds,
          },
        };
      }

      return {
        content: [{ type: "text" as const, text: renderTaskBoardTaskDetail(detail) }],
        details: detail,
      };
    },
  };
}
