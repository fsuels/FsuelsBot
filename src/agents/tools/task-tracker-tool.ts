import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "./common.js";
import {
  loadTaskTrackerState,
  replaceTaskTrackerState,
  resolveTaskTrackerContextFromSessionKey,
  summarizeTaskTrackerUpdate,
  type TaskTrackerTaskInput,
} from "../task-tracker.js";
import { jsonResult, readStringParam } from "./common.js";

const TaskTrackerTaskParamSchema = Type.Object({
  id: Type.String(),
  content: Type.String(),
  activeForm: Type.String(),
  status: Type.String(),
  type: Type.String(),
  ownerAgentId: Type.Optional(Type.String()),
  sessionId: Type.Optional(Type.String()),
  createdAt: Type.Optional(Type.String()),
  updatedAt: Type.Optional(Type.String()),
  blockedReason: Type.Optional(Type.String()),
  unblockAction: Type.Optional(Type.String()),
  followUpTaskId: Type.Optional(Type.String()),
  abandonedReason: Type.Optional(Type.String()),
});

const TaskTrackerToolSchema = Type.Object({
  action: Type.String({ description: "get | replace" }),
  tasks: Type.Optional(Type.Array(TaskTrackerTaskParamSchema)),
});

export function createTaskTrackerTool(opts?: { agentSessionKey?: string }): AnyAgentTool {
  return {
    label: "Task Tracker",
    name: "task_tracker",
    description:
      "Track non-trivial multi-step work with structured tasks that persist per session and agent.",
    parameters: TaskTrackerToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true })?.toLowerCase();
      if (!opts?.agentSessionKey?.trim()) {
        throw new Error("task_tracker requires a live session context.");
      }
      const context = await resolveTaskTrackerContextFromSessionKey(opts.agentSessionKey);

      if (action === "get") {
        const state = await loadTaskTrackerState(context);
        const finalizationBlocked = state.sessionState !== "done";
        return jsonResult({
          activeTasks: state.activeTasks,
          archivedTasks: state.archivedTasks,
          submittedTasks: state.submittedTasks,
          sessionState: state.sessionState,
          finalizationBlocked,
          finalizationReason: finalizationBlocked
            ? state.sessionState === "blocked"
              ? "Session is blocked by one or more tasks."
              : state.activeTasks.length > 0
                ? "Session still has active tasks."
                : "Session is not yet done."
            : undefined,
        });
      }

      if (action === "replace") {
        const rawTasks = Array.isArray(params.tasks)
          ? (params.tasks as TaskTrackerTaskInput[])
          : [];
        const result = await replaceTaskTrackerState({
          context,
          tasks: rawTasks,
        });
        return jsonResult(summarizeTaskTrackerUpdate(result));
      }

      throw new Error(`Unsupported task_tracker action: ${action}`);
    },
  };
}
