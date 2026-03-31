import { Type } from "@sinclair/typebox";
import type { OpenClawConfig } from "../../config/config.js";
import {
  getTaskPlan,
  requestTaskPlanApproval,
  saveTaskPlan,
  TASK_PLAN_STATES,
  TaskPlanError,
  type TaskPlanSnapshot,
} from "../../infra/task-plan.js";
import { stringEnum } from "../schema/typebox.js";
import { buildTaskPlanOperatorManual, TASK_PLAN_INVOCATION_CONTRACT } from "../task-plan-policy.js";
import { defineOpenClawTool } from "../tool-contract.js";
import { createStructuredToolFailureResult } from "../tool-contracts.js";
import { validateFlatActionInput, type ActionValidationRule } from "./action-validation.js";
import { readStringParam, type AnyAgentTool } from "./common.js";
import { resolveTaskToolContext } from "./tasks-shared.js";

const TASK_PLAN_ACTIONS = ["get", "save", "request_approval"] as const;

const TaskPlanToolSchema = Type.Object(
  {
    action: stringEnum(TASK_PLAN_ACTIONS),
    taskId: Type.Optional(
      Type.String({
        minLength: 1,
        description:
          "Task id from tasks_list/task_get. Optional when lanes.bot_current already identifies the active shared task.",
      }),
    ),
    plan: Type.Optional(
      Type.String({
        description:
          "Full markdown plan text. Required for save. Optional for request_approval to overwrite the saved plan just before submission.",
      }),
    ),
  },
  { additionalProperties: false },
);

const TaskPlanToolOutputSchema = Type.Object(
  {
    action: stringEnum(TASK_PLAN_ACTIONS),
    changed: Type.Boolean(),
    taskId: Type.String(),
    filePath: Type.String(),
    absoluteFilePath: Type.String(),
    exists: Type.Boolean(),
    plan: Type.String(),
    approvalState: stringEnum(TASK_PLAN_STATES),
    planWasEdited: Type.Boolean(),
    requestId: Type.Optional(Type.String()),
    requestedAt: Type.Optional(Type.String()),
    decidedAt: Type.Optional(Type.String()),
    decisionNote: Type.Optional(Type.String()),
    taskStatus: Type.Optional(Type.String()),
    boardRevision: Type.Optional(Type.Union([Type.String(), Type.Number()])),
    nextStep: Type.String(),
  },
  { additionalProperties: false },
);

const TASK_PLAN_ACTION_RULES: Record<string, ActionValidationRule> = {
  get: {
    forbid: [{ key: "plan", label: "plan", presence: "defined" }],
  },
  save: {
    required: ["plan"],
  },
  request_approval: {},
};

function renderTaskPlanResult(
  result: {
    action: (typeof TASK_PLAN_ACTIONS)[number];
    changed: boolean;
  } & TaskPlanSnapshot,
): string {
  const lines = [
    `Task plan for ${result.taskId}`,
    `Action: ${result.action}`,
    `State: ${result.approvalState}`,
    `File: ${result.filePath}`,
    `Changed: ${result.changed ? "yes" : "no"}`,
    `Edited since submission: ${result.planWasEdited ? "yes" : "no"}`,
  ];
  if (result.requestId) {
    lines.push(`Request id: ${result.requestId}`);
  }
  if (result.requestedAt) {
    lines.push(`Requested at: ${result.requestedAt}`);
  }
  if (result.decidedAt) {
    lines.push(`Decided at: ${result.decidedAt}`);
  }
  if (result.decisionNote) {
    lines.push(`Decision note: ${result.decisionNote}`);
  }
  lines.push(`Next: ${result.nextStep}`);
  return lines.join("\n");
}

export function createTaskPlanTool(opts?: {
  workspaceDir?: string;
  agentSessionKey?: string;
  config?: OpenClawConfig;
}): AnyAgentTool {
  return defineOpenClawTool({
    label: "Task Plan",
    name: "task_plan",
    description:
      "Read, save, and submit the durable implementation plan for a shared task-board task. Use this for canonical plan storage and approval state, not for research-only notes.",
    parameters: TaskPlanToolSchema,
    inputSchema: TaskPlanToolSchema,
    outputSchema: TaskPlanToolOutputSchema,
    operatorManual: buildTaskPlanOperatorManual,
    invocationContract: TASK_PLAN_INVOCATION_CONTRACT,
    validateInput: async (input, _context) =>
      validateFlatActionInput({
        toolName: "task_plan",
        action: typeof input.action === "string" ? input.action : "",
        input: input as Record<string, unknown>,
        rules: TASK_PLAN_ACTION_RULES,
      }),
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true })?.toLowerCase() as
        | (typeof TASK_PLAN_ACTIONS)[number]
        | undefined;
      const taskId = readStringParam(params, "taskId");
      const plan = readStringParam(params, "plan");
      const { workspaceDir } = resolveTaskToolContext(opts);

      try {
        let result: TaskPlanSnapshot & { changed: boolean };
        if (action === "get") {
          result = {
            ...(await getTaskPlan({ workspaceDir, taskId })),
            changed: false,
          };
        } else if (action === "save") {
          result = await saveTaskPlan({
            workspaceDir,
            taskId,
            plan: plan ?? "",
          });
        } else if (action === "request_approval") {
          result = await requestTaskPlanApproval({
            workspaceDir,
            taskId,
            plan,
          });
        } else {
          return createStructuredToolFailureResult({
            toolName: "task_plan",
            code: "invalid_input",
            message: `Unsupported task_plan action: ${String(action)}`,
          });
        }

        const payload = {
          action,
          changed: result.changed,
          ...result,
        };
        return {
          content: [{ type: "text" as const, text: renderTaskPlanResult(payload) }],
          details: payload,
        };
      } catch (error) {
        if (error instanceof TaskPlanError) {
          return createStructuredToolFailureResult({
            toolName: "task_plan",
            code: error.code,
            message: error.message,
            details: {
              taskId,
              action,
            },
          });
        }
        throw error;
      }
    },
  });
}
