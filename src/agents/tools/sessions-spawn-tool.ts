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
import { isToolAllowedByPolicies, resolveSubagentToolPolicy } from "../pi-tools.policy.js";
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
  ],
  behaviorSummary:
    "Starts a background child agent run in a separate session, records task-output metadata, and can clean up the child session after completion.",
  parametersSummary: [
    "task: required worker instruction.",
    "label: optional stable name for follow-up sends.",
    "agentId: optional cross-agent target when allowlisted.",
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
      const profile = normalizeSubagentCapabilityProfile(profileRaw);
      if (profileRaw && !profile) {
        return jsonResult({
          status: "error",
          error:
            'Invalid profile. Use one of: "research", "implementation", "test-runner", "planner", "custom".',
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
      const blockedRequiredTools = (requiredTools ?? []).filter(
        (toolName) =>
          !isToolAllowedByPolicies(toolName, [resolveSubagentToolPolicy(cfg), sessionToolPolicy]),
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

      const launch = resolveSubagentLaunchConfig({
        cfg,
        requesterSessionKey: requesterInternalKey,
        requesterAgentId,
        targetAgentId,
        task,
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
        task,
        profile,
        requiredTools,
        sessionToolPolicy,
      });

      let childRunId: string = childIdempotencyKey;
      try {
        const response = await callGateway<{ runId: string }>({
          method: "agent",
          params: {
            message: task,
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
        task,
        cleanup,
        label: appliedLabel,
        profile,
        requiredTools,
        sessionToolPolicy,
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
        profile,
        labelApplied: appliedLabel,
        modelApplied: resolvedModel ? modelApplied : undefined,
        modelResolved: resolvedModel,
        thinkingResolved: resolvedThinking,
        warning: modelWarning,
      });
    },
  };
}
