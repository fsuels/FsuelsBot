import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "./common.js";
import { stringEnum } from "../schema/typebox.js";
import {
  createTaskTrackerTask,
  loadTaskTrackerState,
  replaceTaskTrackerState,
  resolveTaskTrackerContextFromSessionKey,
  summarizeTaskTrackerUpdate,
  TaskTrackerStatusSchema,
  updateTaskTrackerTask,
  type TaskTrackerTaskInput,
} from "../task-tracker.js";
import { jsonResult, readStringParam } from "./common.js";

const TaskTrackerTaskParamSchema = Type.Object(
  {
    id: Type.String(),
    content: Type.String(),
    subject: Type.Optional(Type.String()),
    description: Type.Optional(Type.String()),
    activeForm: Type.String(),
    status: Type.String(),
    type: Type.String(),
    ownerAgentId: Type.Optional(Type.String()),
    sessionId: Type.Optional(Type.String()),
    createdAt: Type.Optional(Type.String()),
    updatedAt: Type.Optional(Type.String()),
    metadata: Type.Optional(Type.Object({}, { additionalProperties: true })),
    blockedReason: Type.Optional(Type.String()),
    unblockAction: Type.Optional(Type.String()),
    followUpTaskId: Type.Optional(Type.String()),
    abandonedReason: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

const TASK_TRACKER_ACTIONS = ["get", "replace", "create", "update"] as const;

const TaskTrackerToolSchema = Type.Object(
  {
    action: stringEnum(TASK_TRACKER_ACTIONS),
    tasks: Type.Optional(Type.Array(TaskTrackerTaskParamSchema)),
    subject: Type.Optional(Type.String()),
    description: Type.Optional(Type.String()),
    activeForm: Type.Optional(Type.String()),
    metadata: Type.Optional(Type.Object({}, { additionalProperties: true })),
    taskId: Type.Optional(Type.String()),
    status: Type.Optional(Type.String()),
    blockedReason: Type.Optional(Type.String()),
    unblockAction: Type.Optional(Type.String()),
    followUpTaskId: Type.Optional(Type.String()),
    abandonedReason: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

type ActionFieldPresence = "nonEmpty" | "defined";

type ActionFieldSpec =
  | string
  | {
      key: string;
      label?: string;
      presence?: ActionFieldPresence;
    };

type ActionValidationRule = {
  required?: ActionFieldSpec[];
  oneOf?: Array<{ keys: ActionFieldSpec[]; label?: string }>;
  forbid?: ActionFieldSpec[];
  custom?: (input: Record<string, unknown>) => string | undefined;
};

function resolveFieldSpec(field: ActionFieldSpec) {
  if (typeof field === "string") {
    return {
      key: field,
      label: field,
      presence: "nonEmpty" as const,
    };
  }
  return {
    key: field.key,
    label: field.label ?? field.key,
    presence: field.presence ?? "nonEmpty",
  };
}

function hasFieldValue(value: unknown, presence: ActionFieldPresence): boolean {
  if (presence === "defined") {
    return value !== undefined && value !== null;
  }
  if (value === undefined || value === null) {
    return false;
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  return true;
}

function validateTaskTrackerActionInput(params: {
  action: string;
  input: Record<string, unknown>;
}): { result: true } | { result: false; errorCode: number; message: string } {
  const rule = TASK_TRACKER_ACTION_RULES[params.action];
  if (!rule) {
    return {
      result: false,
      errorCode: 400,
      message: `Unsupported task_tracker action: ${params.action}`,
    };
  }

  for (const field of rule.required ?? []) {
    const spec = resolveFieldSpec(field);
    if (!hasFieldValue(params.input[spec.key], spec.presence)) {
      return {
        result: false,
        errorCode: 400,
        message: `${spec.label} required for action=${params.action}`,
      };
    }
  }

  for (const group of rule.oneOf ?? []) {
    const matched = group.keys.some((field) => {
      const spec = resolveFieldSpec(field);
      return hasFieldValue(params.input[spec.key], spec.presence);
    });
    if (!matched) {
      const label =
        group.label ?? group.keys.map((field) => resolveFieldSpec(field).label).join(" or ");
      return {
        result: false,
        errorCode: 400,
        message: `${label} required for action=${params.action}`,
      };
    }
  }

  for (const field of rule.forbid ?? []) {
    const spec = resolveFieldSpec(field);
    if (hasFieldValue(params.input[spec.key], spec.presence)) {
      return {
        result: false,
        errorCode: 400,
        message: `${spec.label} is not supported for action=${params.action}`,
      };
    }
  }

  const customError = rule.custom?.(params.input);
  if (customError) {
    return {
      result: false,
      errorCode: 400,
      message: customError,
    };
  }

  return { result: true };
}

const TASK_TRACKER_ACTION_RULES: Record<string, ActionValidationRule> = {
  get: {
    forbid: [
      { key: "tasks", label: "tasks", presence: "defined" },
      { key: "subject", label: "subject", presence: "defined" },
      { key: "description", label: "description", presence: "defined" },
      { key: "activeForm", label: "activeForm", presence: "defined" },
      { key: "metadata", label: "metadata", presence: "defined" },
      { key: "taskId", label: "taskId", presence: "defined" },
      { key: "status", label: "status", presence: "defined" },
      { key: "blockedReason", label: "blockedReason", presence: "defined" },
      { key: "unblockAction", label: "unblockAction", presence: "defined" },
      { key: "followUpTaskId", label: "followUpTaskId", presence: "defined" },
      { key: "abandonedReason", label: "abandonedReason", presence: "defined" },
    ],
  },
  replace: {
    required: [{ key: "tasks", label: "tasks", presence: "defined" }],
    forbid: [
      { key: "subject", label: "subject", presence: "defined" },
      { key: "description", label: "description", presence: "defined" },
      { key: "activeForm", label: "activeForm", presence: "defined" },
      { key: "metadata", label: "metadata", presence: "defined" },
      { key: "taskId", label: "taskId", presence: "defined" },
      { key: "status", label: "status", presence: "defined" },
      { key: "blockedReason", label: "blockedReason", presence: "defined" },
      { key: "unblockAction", label: "unblockAction", presence: "defined" },
      { key: "followUpTaskId", label: "followUpTaskId", presence: "defined" },
      { key: "abandonedReason", label: "abandonedReason", presence: "defined" },
    ],
  },
  create: {
    required: ["subject", "description"],
    forbid: [
      { key: "tasks", label: "tasks", presence: "defined" },
      { key: "taskId", label: "taskId", presence: "defined" },
      { key: "status", label: "status", presence: "defined" },
      { key: "blockedReason", label: "blockedReason", presence: "defined" },
      { key: "unblockAction", label: "unblockAction", presence: "defined" },
      { key: "followUpTaskId", label: "followUpTaskId", presence: "defined" },
      { key: "abandonedReason", label: "abandonedReason", presence: "defined" },
    ],
  },
  update: {
    required: ["taskId"],
    oneOf: [
      {
        label:
          "status, activeForm, subject, description, metadata, blockedReason, unblockAction, followUpTaskId, or abandonedReason",
        keys: [
          { key: "status", presence: "defined" },
          { key: "activeForm", presence: "defined" },
          { key: "subject", presence: "defined" },
          { key: "description", presence: "defined" },
          { key: "metadata", presence: "defined" },
          { key: "blockedReason", presence: "defined" },
          { key: "unblockAction", presence: "defined" },
          { key: "followUpTaskId", presence: "defined" },
          { key: "abandonedReason", presence: "defined" },
        ],
      },
    ],
    forbid: [{ key: "tasks", label: "tasks", presence: "defined" }],
    custom: (input) => {
      if (typeof input.status !== "string") {
        return undefined;
      }
      const parsed = TaskTrackerStatusSchema.safeParse(input.status);
      if (parsed.success) {
        return undefined;
      }
      return `status must be one of: ${TaskTrackerStatusSchema.options.join(", ")}`;
    },
  },
};

export function createTaskTrackerTool(opts?: { agentSessionKey?: string }): AnyAgentTool {
  return {
    label: "Task Tracker",
    name: "task_tracker",
    description:
      "Track non-trivial multi-step work with structured create, update, get, and replace actions that persist per session and agent.",
    parameters: TaskTrackerToolSchema,
    validateInput: async (input, _context) =>
      validateTaskTrackerActionInput({
        action: typeof input.action === "string" ? input.action : "",
        input: input as Record<string, unknown>,
      }),
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

      if (action === "create") {
        const result = await createTaskTrackerTask({
          context,
          subject: readStringParam(params, "subject", { required: true }),
          description: readStringParam(params, "description", { required: true }),
          activeForm: readStringParam(params, "activeForm"),
          metadata:
            params.metadata &&
            typeof params.metadata === "object" &&
            !Array.isArray(params.metadata)
              ? (params.metadata as Record<string, unknown>)
              : undefined,
        });
        return jsonResult({
          task: {
            id: result.task.id,
            subject: result.task.subject ?? result.task.content,
          },
          created: result.created,
          duplicate: result.duplicate,
        });
      }

      if (action === "update") {
        const result = await updateTaskTrackerTask({
          context,
          taskId: readStringParam(params, "taskId", { required: true }),
          status:
            typeof params.status === "string"
              ? TaskTrackerStatusSchema.parse(params.status)
              : undefined,
          activeForm: readStringParam(params, "activeForm"),
          subject: readStringParam(params, "subject"),
          description: readStringParam(params, "description"),
          metadata:
            params.metadata &&
            typeof params.metadata === "object" &&
            !Array.isArray(params.metadata)
              ? (params.metadata as Record<string, unknown>)
              : undefined,
          blockedReason: readStringParam(params, "blockedReason"),
          unblockAction: readStringParam(params, "unblockAction"),
          followUpTaskId: readStringParam(params, "followUpTaskId"),
          abandonedReason: readStringParam(params, "abandonedReason"),
        });
        return jsonResult({
          task: {
            id: result.task.id,
            subject: result.task.subject ?? result.task.content,
            status: result.task.status,
          },
          sessionState: result.state.sessionState,
          finalizationBlocked: result.finalizationBlocked,
          finalizationReason: result.finalizationReason,
          autoCreatedTasks: result.autoCreatedTasks.map((task) => ({
            id: task.id,
            subject: task.subject ?? task.content,
            type: task.type,
          })),
        });
      }

      throw new Error(`Unsupported task_tracker action: ${action}`);
    },
  };
}
