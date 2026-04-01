import { Type } from "@sinclair/typebox";
import type { GatewayMessageChannel } from "../../utils/message-channel.js";
import type { AnyAgentTool } from "./common.js";
import { loadConfig } from "../../config/config.js";
import { callGateway } from "../../gateway/call.js";
import {
  isSubagentSessionKey,
  normalizeAgentId,
  parseAgentSessionKey,
} from "../../routing/session-key.js";
import { SESSION_LABEL_MAX_LENGTH, parseSessionLabel } from "../../sessions/session-label.js";
import { normalizeDeliveryContext } from "../../utils/delivery-context.js";
import { resolveAgentConfig } from "../agent-scope.js";
import { AGENT_LANE_SUBAGENT } from "../lanes.js";
import { optionalStringEnum } from "../schema/typebox.js";
import { buildSubagentSystemPrompt } from "../subagent-announce.js";
import {
  reserveSubagentSessionSettings,
  resolveSubagentLaunchConfig,
} from "../subagent-launch-config.js";
import {
  buildSubagentSessionToolPolicy,
  normalizeSubagentCapabilityProfile,
  normalizeSubagentRequiredTools,
} from "../subagent-policy.js";
import { getSubagentRun, registerSubagentRun } from "../subagent-registry.js";
import {
  buildSubagentTaskSpec,
  inferProfileFromTaskType,
  inferTaskTypeFromProfile,
  normalizeSubagentTaskType,
  validateTaskTypeProfileCompatibility,
} from "../subagent-task-spec.js";
import { resolveSubagentToolSurface } from "../subagent-tool-resolution.js";
import {
  type ToolInvocationContract,
  toolValidationError,
  toolValidationOk,
} from "../tool-contract.js";
import { assertKnownParams, jsonResult, readStringParam } from "./common.js";
import {
  resolveDisplaySessionKey,
  resolveInternalSessionKey,
  resolveMainSessionAlias,
} from "./sessions-helpers.js";

const SessionsSpawnToolSchema = Type.Object(
  {
    task: Type.String({
      description: "Prompt or task description for the spawned sub-agent run.",
    }),
    label: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: SESSION_LABEL_MAX_LENGTH,
        description: "Optional human-readable label for the spawned session.",
      }),
    ),
    agentId: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 64,
        description: "Optional target agent id. Defaults to the requester agent.",
      }),
    ),
    model: Type.Optional(
      Type.String({
        description:
          'Optional provider/model override for the child session. Use "inherit" to force the caller\'s effective model.',
      }),
    ),
    thinking: Type.Optional(
      Type.String({
        description:
          'Optional child-session thinking level override. Use "inherit" to reuse the caller\'s effective thinking level.',
      }),
    ),
    runTimeoutSeconds: Type.Optional(
      Type.Number({
        minimum: 0,
        description: "Preferred timeout override for waiting on the child run.",
      }),
    ),
    // Back-compat alias. Prefer runTimeoutSeconds.
    timeoutSeconds: Type.Optional(
      Type.Number({
        minimum: 0,
        description:
          "Deprecated alias for runTimeoutSeconds. Kept for transcript replay/backward compatibility.",
      }),
    ),
    cleanup: optionalStringEnum(["delete", "keep"] as const),
    profile: optionalStringEnum([
      "research",
      "implementation",
      "test-runner",
      "planner",
      "custom",
    ] as const),
    taskType: Type.Optional(
      Type.String({
        description:
          'Optional structured task type: "research", "synthesis", "implementation", "correction", or "verification".',
      }),
    ),
    purpose: Type.Optional(
      Type.String({
        description:
          "Optional short purpose statement. When combined with facts/doneCriteria, OpenClaw generates a self-contained worker prompt.",
      }),
    ),
    facts: Type.Optional(
      Type.Array(
        Type.String({
          description: "Concrete fact the worker needs inline.",
        }),
      ),
    ),
    doneCriteria: Type.Optional(
      Type.Array(
        Type.String({
          description: "Explicit completion criteria for the worker handoff.",
        }),
      ),
    ),
    constraints: Type.Optional(
      Type.Array(
        Type.String({
          description: "Constraint the worker must honor.",
        }),
      ),
    ),
    commands: Type.Optional(
      Type.Array(
        Type.String({
          description: "Suggested command or verification step.",
        }),
      ),
    ),
    filePaths: Type.Optional(
      Type.Array(
        Type.String({
          description: "Relevant file path for the task.",
        }),
      ),
    ),
    symbols: Type.Optional(
      Type.Array(
        Type.String({
          description: "Relevant symbol, function, or class name.",
        }),
      ),
    ),
    errors: Type.Optional(
      Type.Array(
        Type.String({
          description: "Known failing behavior, error text, or stack excerpt.",
        }),
      ),
    ),
    sourceTaskId: Type.Optional(
      Type.String({
        description: "Optional source task/run id being continued, corrected, or verified.",
      }),
    ),
    allowFileChanges: Type.Optional(
      Type.Boolean({
        description:
          "Optional explicit file-modification flag. Research and verification default to false.",
      }),
    ),
    requiredTools: Type.Optional(
      Type.Array(
        Type.String({
          description: "Tool name required for the spawned sub-agent session.",
        }),
      ),
    ),
    toolAllow: Type.Optional(
      Type.Array(
        Type.String({
          description: "Tool name to allow in the spawned sub-agent session.",
        }),
      ),
    ),
    toolDeny: Type.Optional(
      Type.Array(
        Type.String({
          description: "Tool name to deny in the spawned sub-agent session.",
        }),
      ),
    ),
  },
  { additionalProperties: false },
);

const SESSIONS_SPAWN_INVOCATION_CONTRACT: ToolInvocationContract = {
  usagePolicy: "explicit_only",
  sideEffectLevel: "high",
  whenToUse: [
    "The user explicitly asks you to spawn, create, start, or hand work to a separate worker/sub-agent session.",
    "You need parallel or durable background work in another session.",
  ],
  whenNotToUse: [
    "Do not use for local work you can do in the current session.",
    "Do not infer a sub-agent spawn from requests like switch branch, inspect files, or fix a bug unless the user also asked for delegation/parallel work.",
    "Do not use from inside an existing sub-agent session.",
  ],
  preconditions: [
    "A concrete child task is ready.",
    "If targeting another agent, that agent must be allowlisted for the requester.",
    "Pick a capability profile or requiredTools when the worker's scope is obvious.",
    "For synthesis, implementation, correction, or verification work, prefer taskType + facts + doneCriteria so the worker prompt is self-contained.",
  ],
  behaviorSummary:
    "Starts a background child agent run in a separate session, records task-output metadata, can render a self-contained worker prompt from structured fields, and can clean up the child session after completion.",
  parametersSummary: [
    "task: required worker instruction.",
    "label: optional stable name for follow-up sends.",
    "agentId: optional cross-agent target when allowlisted.",
    "taskType/purpose/facts/doneCriteria/...: optional structured handoff fields for self-contained worker prompts.",
    "profile, requiredTools, toolAllow, toolDeny: worker capability controls.",
    "runTimeoutSeconds: optional wait timeout for the child run.",
    "cleanup: keep or delete the child session after it finishes.",
  ],
};

export function createSessionsSpawnTool(opts?: {
  agentSessionKey?: string;
  agentChannel?: GatewayMessageChannel;
  agentAccountId?: string;
  agentTo?: string;
  agentThreadId?: string | number;
  agentGroupId?: string | null;
  agentGroupChannel?: string | null;
  agentGroupSpace?: string | null;
  sandboxed?: boolean;
  /** Explicit agent ID override for cron/hook sessions where session key parsing may not work. */
  requesterAgentIdOverride?: string;
}): AnyAgentTool {
  return {
    label: "Sessions",
    name: "sessions_spawn",
    description:
      "Spawn a background sub-agent run in a new isolated child session. The current requester session/agent are inferred from runtime context; omit agentId unless you need an allowlisted cross-agent handoff. cleanup=delete removes the child session only after the run finishes and its result is safely announced.",
    parameters: SessionsSpawnToolSchema,
    invocationContract: SESSIONS_SPAWN_INVOCATION_CONTRACT,
    validateInput: async (input, _context) => {
      if (typeof input.label === "string") {
        const parsed = parseSessionLabel(input.label);
        if (!parsed.ok) {
          return toolValidationError({
            code: "invalid_input",
            message: parsed.error,
          });
        }
      }
      return toolValidationOk();
    },
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      assertKnownParams(
        params,
        [
          "task",
          "label",
          "agentId",
          "model",
          "thinking",
          "runTimeoutSeconds",
          "timeoutSeconds",
          "cleanup",
          "profile",
          "taskType",
          "purpose",
          "facts",
          "doneCriteria",
          "constraints",
          "commands",
          "filePaths",
          "symbols",
          "errors",
          "sourceTaskId",
          "allowFileChanges",
          "requiredTools",
          "toolAllow",
          "toolDeny",
        ],
        { label: "sessions_spawn" },
      );
      const task = readStringParam(params, "task", { required: true });
      const label = typeof params.label === "string" ? params.label.trim() : "";
      const requestedAgentId = readStringParam(params, "agentId");
      const modelOverride = readStringParam(params, "model");
      const thinkingOverrideRaw = readStringParam(params, "thinking");
      const profileRaw = readStringParam(params, "profile");
      const cleanup =
        params.cleanup === "keep" || params.cleanup === "delete" ? params.cleanup : "keep";
      const requestedProfile = normalizeSubagentCapabilityProfile(profileRaw);
      if (profileRaw && !requestedProfile) {
        return jsonResult({
          status: "error",
          error:
            'Invalid profile. Use one of: "research", "implementation", "test-runner", "planner", "custom".',
        });
      }
      const taskTypeRaw = readStringParam(params, "taskType");
      if (taskTypeRaw && !normalizeSubagentTaskType(taskTypeRaw)) {
        return jsonResult({
          status: "error",
          error:
            'Invalid taskType. Use one of: "research", "synthesis", "implementation", "correction", or "verification".',
        });
      }
      const taskSpec = buildSubagentTaskSpec({
        task,
        taskType: taskTypeRaw,
        purpose: params.purpose,
        facts: params.facts,
        doneCriteria: params.doneCriteria,
        constraints: params.constraints,
        commands: params.commands,
        filePaths: params.filePaths,
        symbols: params.symbols,
        errors: params.errors,
        sourceTaskId: params.sourceTaskId,
        allowFileChanges: params.allowFileChanges,
        defaultTaskType: inferTaskTypeFromProfile(requestedProfile),
      });
      if (!taskSpec.ok) {
        return jsonResult({
          status: "error",
          error: taskSpec.error,
        });
      }
      const profile = requestedProfile ?? inferProfileFromTaskType(taskSpec.value.taskType);
      const profileCompatibilityError = validateTaskTypeProfileCompatibility({
        taskType: taskSpec.value.taskType,
        profile,
      });
      if (profileCompatibilityError) {
        return jsonResult({
          status: "error",
          error: profileCompatibilityError,
        });
      }
      const requiredTools = normalizeSubagentRequiredTools(params.requiredTools);
      const toolAllow = normalizeSubagentRequiredTools(params.toolAllow);
      const toolDeny = normalizeSubagentRequiredTools(params.toolDeny);
      const sessionToolPolicy = buildSubagentSessionToolPolicy({
        profile,
        toolAllow,
        toolDeny,
      });
      const requesterOrigin = normalizeDeliveryContext({
        channel: opts?.agentChannel,
        accountId: opts?.agentAccountId,
        to: opts?.agentTo,
        threadId: opts?.agentThreadId,
      });
      const runTimeoutSeconds = (() => {
        const explicit =
          typeof params.runTimeoutSeconds === "number" && Number.isFinite(params.runTimeoutSeconds)
            ? Math.max(0, Math.floor(params.runTimeoutSeconds))
            : undefined;
        if (explicit !== undefined) {
          return explicit;
        }
        const legacy =
          typeof params.timeoutSeconds === "number" && Number.isFinite(params.timeoutSeconds)
            ? Math.max(0, Math.floor(params.timeoutSeconds))
            : undefined;
        return legacy ?? 0;
      })();
      let modelWarning: string | undefined;
      let modelApplied = false;

      const cfg = loadConfig();
      const { mainKey, alias } = resolveMainSessionAlias(cfg);
      const requesterSessionKey = opts?.agentSessionKey;
      if (typeof requesterSessionKey === "string" && isSubagentSessionKey(requesterSessionKey)) {
        return jsonResult({
          status: "forbidden",
          error: "sessions_spawn is not allowed from sub-agent sessions",
        });
      }
      const requesterInternalKey = requesterSessionKey
        ? resolveInternalSessionKey({
            key: requesterSessionKey,
            alias,
            mainKey,
          })
        : alias;
      const requesterDisplayKey = resolveDisplaySessionKey({
        key: requesterInternalKey,
        alias,
        mainKey,
      });

      const requesterAgentId = normalizeAgentId(
        opts?.requesterAgentIdOverride ?? parseAgentSessionKey(requesterInternalKey)?.agentId,
      );
      const targetAgentId = requestedAgentId
        ? normalizeAgentId(requestedAgentId)
        : requesterAgentId;
      if (targetAgentId !== requesterAgentId) {
        const allowAgents = resolveAgentConfig(cfg, requesterAgentId)?.subagents?.allowAgents ?? [];
        const allowAny = allowAgents.some((value) => value.trim() === "*");
        const normalizedTargetId = targetAgentId.toLowerCase();
        const allowSet = new Set(
          allowAgents
            .filter((value) => value.trim() && value.trim() !== "*")
            .map((value) => normalizeAgentId(value).toLowerCase()),
        );
        if (!allowAny && !allowSet.has(normalizedTargetId)) {
          const allowedText = allowAny
            ? "*"
            : allowSet.size > 0
              ? Array.from(allowSet).join(", ")
              : "none";
          return jsonResult({
            status: "forbidden",
            error: `agentId is not allowed for sessions_spawn (allowed: ${allowedText})`,
          });
        }
      }
      const spawnedByKey = requesterInternalKey;

      const launch = resolveSubagentLaunchConfig({
        cfg,
        requesterSessionKey: requesterInternalKey,
        requesterAgentId,
        targetAgentId,
        task: taskSpec.value.taskText,
        label: label || undefined,
        toolCallId: _toolCallId,
        requestedModel: modelOverride,
        requestedThinking: thinkingOverrideRaw,
      });
      if (!launch.ok) {
        return jsonResult({
          status: "error",
          error: launch.error,
        });
      }

      const { childSessionKey, childIdempotencyKey, resolvedModel, resolvedThinking } =
        launch.value;
      const toolResolution = resolveSubagentToolSurface({
        config: cfg,
        targetAgentId,
        sessionKey: childSessionKey,
        sessionToolPolicy,
        requiredTools,
        toolAllow,
        toolDeny,
      });
      if (toolResolution.invalidTools.length > 0) {
        const invalidSections = [
          toolResolution.invalidByField.requiredTools.length > 0
            ? `requiredTools=${toolResolution.invalidByField.requiredTools.join(", ")}`
            : undefined,
          toolResolution.invalidByField.toolAllow.length > 0
            ? `toolAllow=${toolResolution.invalidByField.toolAllow.join(", ")}`
            : undefined,
          toolResolution.invalidByField.toolDeny.length > 0
            ? `toolDeny=${toolResolution.invalidByField.toolDeny.join(", ")}`
            : undefined,
        ].filter(Boolean);
        return jsonResult({
          status: "error",
          error: `Invalid subagent tool specs: ${invalidSections.join("; ")}`,
        });
      }
      const blockedRequiredTools = (requiredTools ?? []).filter(
        (toolName) => !toolResolution.resolvedTools.includes(toolName),
      );
      if (blockedRequiredTools.length > 0) {
        const profileLabel = profile ?? "default";
        return jsonResult({
          status: "error",
          error:
            `Subagent profile "${profileLabel}" cannot satisfy requiredTools: ` +
            blockedRequiredTools.join(", "),
        });
      }

      let appliedLabel = label || undefined;
      try {
        const reserved = await reserveSubagentSessionSettings({
          childSessionKey,
          label: label || undefined,
          resolvedModel,
          resolvedThinking,
        });
        appliedLabel = reserved.appliedLabel ?? appliedLabel;
        modelApplied = reserved.modelApplied ?? false;
        modelWarning = reserved.modelWarning;
      } catch (err) {
        const messageText =
          err instanceof Error ? err.message : typeof err === "string" ? err : "error";
        return jsonResult({
          status: "error",
          error: messageText,
          childSessionKey,
        });
      }

      const childSystemPrompt = buildSubagentSystemPrompt({
        requesterSessionKey,
        requesterOrigin,
        childSessionKey,
        label: appliedLabel,
        task: taskSpec.value.taskText,
        taskSummary: taskSpec.value.taskSummary,
        profile,
        requiredTools,
        sessionToolPolicy,
        resolvedTools: toolResolution.resolvedTools,
      });

      let childRunId: string = childIdempotencyKey;
      try {
        const response = await callGateway<{ runId: string }>({
          method: "agent",
          params: {
            message: taskSpec.value.taskText,
            sessionKey: childSessionKey,
            channel: requesterOrigin?.channel,
            to: requesterOrigin?.to ?? undefined,
            accountId: requesterOrigin?.accountId ?? undefined,
            threadId:
              requesterOrigin?.threadId != null ? String(requesterOrigin.threadId) : undefined,
            idempotencyKey: childIdempotencyKey,
            deliver: false,
            lane: AGENT_LANE_SUBAGENT,
            extraSystemPrompt: childSystemPrompt,
            thinking: resolvedThinking,
            timeout: runTimeoutSeconds > 0 ? runTimeoutSeconds : undefined,
            spawnedBy: spawnedByKey,
            groupId: opts?.agentGroupId ?? undefined,
            groupChannel: opts?.agentGroupChannel ?? undefined,
            groupSpace: opts?.agentGroupSpace ?? undefined,
          },
          timeoutMs: 10_000,
        });
        if (typeof response?.runId === "string" && response.runId) {
          childRunId = response.runId;
        }
      } catch (err) {
        const messageText =
          err instanceof Error ? err.message : typeof err === "string" ? err : "error";
        return jsonResult({
          status: "error",
          error: messageText,
          childSessionKey,
          runId: childRunId,
        });
      }

      registerSubagentRun({
        runId: childRunId,
        childSessionKey,
        requesterSessionKey: requesterInternalKey,
        requesterOrigin,
        requesterDisplayKey,
        task: taskSpec.value.taskText,
        taskSummary: taskSpec.value.taskSummary,
        taskType: taskSpec.value.taskType,
        filePaths: taskSpec.value.filePaths,
        sourceTaskId: taskSpec.value.sourceTaskId,
        allowFileChanges: taskSpec.value.allowFileChanges,
        cleanup,
        label: appliedLabel,
        profile,
        requiredTools,
        sessionToolPolicy,
        resolvedTools: toolResolution.resolvedTools,
        runTimeoutSeconds,
      });
      const taskEntry = getSubagentRun(childRunId);

      return jsonResult({
        status: "accepted",
        task_id: childRunId,
        task_type: "agent",
        childSessionKey,
        runId: childRunId,
        output_path: taskEntry?.outputPath,
        transcript_path: taskEntry?.transcriptPath,
        notified: taskEntry?.notified ?? false,
        taskType: taskSpec.value.taskType,
        taskStructured: taskSpec.value.isStructured,
        profile,
        resolvedTools: toolResolution.resolvedTools,
        validTools: toolResolution.validTools,
        labelApplied: appliedLabel,
        modelApplied: resolvedModel ? modelApplied : undefined,
        modelResolved: resolvedModel,
        thinkingResolved: resolvedThinking,
        warning: modelWarning,
      });
    },
  };
}
