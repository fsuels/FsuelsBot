import type { OpenClawConfig } from "../../config/config.js";
import type { AnyAgentTool } from "./common.js";
import {
  loadTaskBoardSnapshot,
  renderTaskBoardList,
  type TaskBoardSnapshot,
} from "../../infra/task-board-view.js";
import { defineOpenClawTool } from "../tool-contract.js";
import {
  resolveTaskToolContext,
  TaskBoardSnapshotSchema,
  TasksListToolInputSchema,
} from "./tasks-shared.js";

function buildTasksListResult(snapshot: TaskBoardSnapshot) {
  return {
    content: [{ type: "text" as const, text: renderTaskBoardList(snapshot) }],
    details: snapshot,
  };
}

export function createTasksListTool(opts?: {
  workspaceDir?: string;
  agentSessionKey?: string;
  config?: OpenClawConfig;
}): AnyAgentTool {
  return defineOpenClawTool({
    label: "Tasks",
    name: "tasks_list",
    description:
      "List visible tasks with derived readiness, blocker, and ownership fields. Use before choosing work; prefer the lowest-ID ready task first, then use task_get for the full card.",
    parameters: TasksListToolInputSchema,
    inputSchema: TasksListToolInputSchema,
    outputSchema: TaskBoardSnapshotSchema,
    userFacingName: () => "Task Board",
    isReadOnly: () => true,
    isConcurrencySafe: () => true,
    execute: async () => {
      const { workspaceDir } = resolveTaskToolContext(opts);
      const { snapshot } = await loadTaskBoardSnapshot({ workspaceDir });
      return buildTasksListResult(snapshot);
    },
  });
}
