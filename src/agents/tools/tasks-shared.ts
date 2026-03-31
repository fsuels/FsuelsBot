import { Type } from "@sinclair/typebox";
import type { OpenClawConfig } from "../../config/config.js";
import { loadConfig } from "../../config/config.js";
import { resolveAgentWorkspaceDir, resolveSessionAgentId } from "../agent-scope.js";
import { createStrictEmptyObjectSchema } from "../tool-contract.js";

export const TaskBoardStatusSchema = Type.Union([
  Type.Literal("pending"),
  Type.Literal("in_progress"),
  Type.Literal("completed"),
  Type.Literal("blocked"),
]);

export const TaskBoardReadyReasonSchema = Type.Union([
  Type.Literal("ready"),
  Type.Literal("blocked"),
  Type.Literal("blocked_by_tasks"),
  Type.Literal("blocked_by_note"),
  Type.Literal("claimed"),
  Type.Literal("completed"),
  Type.Literal("in_progress"),
  Type.Literal("needs_human"),
  Type.Literal("paused"),
  Type.Literal("pending"),
]);

const TaskSummarySchemaProperties = {
  id: Type.String(),
  title: Type.String(),
  subject: Type.String(),
  status: TaskBoardStatusSchema,
  rawStatus: Type.Optional(Type.String()),
  lane: Type.Optional(Type.String()),
  rawLane: Type.Optional(Type.String()),
  owner: Type.Optional(Type.String()),
  hasOwner: Type.Boolean(),
  blockedBy: Type.Array(Type.String()),
  blockers: Type.Array(Type.String()),
  isBlocked: Type.Boolean(),
  isAvailableToClaim: Type.Boolean(),
  isReady: Type.Boolean(),
  readyReason: TaskBoardReadyReasonSchema,
  needsHuman: Type.Boolean(),
  isPaused: Type.Boolean(),
  file: Type.Optional(Type.String()),
  plan: Type.Optional(Type.String()),
  kind: Type.Optional(Type.String()),
  summary: Type.Optional(Type.String()),
  goal: Type.Optional(Type.String()),
  nextAction: Type.Optional(Type.String()),
  next_action: Type.Optional(Type.String()),
  progress: Type.Optional(Type.String()),
  stepCount: Type.Optional(Type.Number()),
  stepsDone: Type.Optional(Type.Number()),
} as const;

export const TasksListToolInputSchema = createStrictEmptyObjectSchema({
  description: "No arguments accepted.",
});

export const TaskBoardSummarySchema = Type.Object(
  {
    total: Type.Number({ minimum: 0 }),
    pending: Type.Number({ minimum: 0 }),
    in_progress: Type.Number({ minimum: 0 }),
    completed: Type.Number({ minimum: 0 }),
    blocked: Type.Number({ minimum: 0 }),
    available: Type.Number({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const TaskBoardTaskSummarySchema = Type.Object(TaskSummarySchemaProperties, {
  additionalProperties: false,
});

export const TaskBoardSnapshotSchema = Type.Object(
  {
    version: Type.Optional(Type.Number()),
    updatedAt: Type.Optional(Type.String()),
    summary: TaskBoardSummarySchema,
    tasks: Type.Array(TaskBoardTaskSummarySchema),
    lanes: Type.Record(Type.String(), Type.Array(Type.String())),
  },
  { additionalProperties: false },
);

const TaskBoardTaskStepSchema = Type.Object(
  {
    id: Type.Optional(Type.String()),
    text: Type.Optional(Type.String()),
    status: Type.Optional(Type.String()),
    checked: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const TaskBoardTaskDetailSchema = Type.Object(
  {
    ...TaskSummarySchemaProperties,
    createdAt: Type.Optional(Type.String()),
    updatedAt: Type.Optional(Type.String()),
    startedAt: Type.Optional(Type.String()),
    currentStep: Type.Optional(Type.Number()),
    current_step: Type.Optional(Type.Number()),
    steps: Type.Optional(Type.Array(TaskBoardTaskStepSchema)),
    context: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    links: Type.Optional(Type.Array(Type.Unknown())),
    handoff: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  { additionalProperties: false },
);

export function resolveTaskToolContext(opts?: {
  workspaceDir?: string;
  agentSessionKey?: string;
  config?: OpenClawConfig;
}): {
  config: OpenClawConfig;
  agentId: string;
  workspaceDir: string;
} {
  const config = opts?.config ?? loadConfig();
  const agentId = resolveSessionAgentId({
    sessionKey: opts?.agentSessionKey,
    config,
  });
  return {
    config,
    agentId,
    workspaceDir: opts?.workspaceDir ?? resolveAgentWorkspaceDir(config, agentId),
  };
}
