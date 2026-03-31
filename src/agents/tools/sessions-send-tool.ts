import { Type } from "@sinclair/typebox";
import crypto from "node:crypto";
import type { AnyAgentTool } from "./common.js";
import { loadConfig } from "../../config/config.js";
import { callGateway } from "../../gateway/call.js";
import { loadSessionEntry } from "../../gateway/session-utils.js";
import {
  isSubagentSessionKey,
  normalizeAgentId,
  resolveAgentIdFromSessionKey,
} from "../../routing/session-key.js";
import { SESSION_LABEL_MAX_LENGTH, parseSessionLabel } from "../../sessions/session-label.js";
import {
  type GatewayMessageChannel,
  INTERNAL_MESSAGE_CHANNEL,
} from "../../utils/message-channel.js";
import { AGENT_LANE_NESTED } from "../lanes.js";
import {
  isEmbeddedPiRunActive,
  queueEmbeddedPiMessage,
  waitForEmbeddedPiRunEnd,
} from "../pi-embedded.js";
import {
  type ToolInvocationContract,
  toolValidationError,
  toolValidationOk,
} from "../tool-contract.js";
import { readLatestAssistantReply } from "./agent-step.js";
import {
  assertKnownParams,
  jsonResult,
  readAliasedStringParam,
  readStringParam,
} from "./common.js";
import {
  createAgentToAgentPolicy,
  resolveInternalSessionKey,
  resolveMainSessionAlias,
  resolveSessionReference,
} from "./sessions-helpers.js";
import { buildAgentToAgentMessageContext, resolvePingPongTurns } from "./sessions-send-helpers.js";
import { runSessionsSendA2AFlow } from "./sessions-send-tool.a2a.js";

const SessionsSendToolSchema = Type.Object(
  {
    sessionKey: Type.Optional(
      Type.String({
        description:
          "Canonical target session key. Prefer this over the deprecated sessionId field.",
      }),
    ),
    sessionId: Type.Optional(
      Type.String({
        description:
          "Deprecated alias for sessionKey. Kept for transcript replay/backward compatibility.",
      }),
    ),
    label: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: SESSION_LABEL_MAX_LENGTH,
        description:
          "Target session label. Use this instead of sessionKey when addressing by label.",
      }),
    ),
    agentId: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 64,
        description: "Optional agent id scope when resolving a label target.",
      }),
    ),
    message: Type.String({
      description: "Message to inject into the target session.",
    }),
    timeoutSeconds: Type.Optional(
      Type.Number({
        minimum: 0,
        description: "Wait timeout in seconds. Use 0 for fire-and-forget behavior.",
      }),
    ),
  },
  { additionalProperties: false },
);

const SESSIONS_SEND_INVOCATION_CONTRACT: ToolInvocationContract = {
  usagePolicy: "explicit_only",
  sideEffectLevel: "high",
  whenToUse: [
    "The user explicitly asks you to message, ping, continue, or follow up with another session or worker.",
    "You already know the target session and need to inject a message into it.",
  ],
  whenNotToUse: [
    "Do not use for your normal reply to the current user.",
    "Do not use to create a new worker when no target session exists; use sessions_spawn instead.",
    "Do not infer cross-session messaging from a generic request to do work locally.",
  ],
  preconditions: [
    "Provide either sessionKey or label, not both.",
    "If resolving by label across agents, cross-agent messaging must be allowed.",
  ],
  behaviorSummary:
    "Injects a message into another session, optionally waits for a reply, and may route through the active in-process run when that session is already streaming.",
  parametersSummary: [
    "sessionKey or label: target session identifier.",
    "agentId: optional label-resolution scope for cross-agent targets.",
    "message: required text to deliver.",
    "timeoutSeconds: 0 for fire-and-forget, positive to wait for a reply.",
  ],
};

function resolveRuntimeTargetSession(sessionKey: string) {
  try {
    const { canonicalKey, entry } = loadSessionEntry(sessionKey);
    const sessionId =
      typeof entry?.sessionId === "string" && entry.sessionId.trim()
        ? entry.sessionId.trim()
        : undefined;
    return {
      sessionKey: canonicalKey,
      sessionId,
    };
  } catch {
    return {
      sessionKey,
      sessionId: undefined,
    };
  }
}

export function createSessionsSendTool(opts?: {
  agentSessionKey?: string;
  agentChannel?: GatewayMessageChannel;
  sandboxed?: boolean;
}): AnyAgentTool {
  return {
    label: "Session Send",
    name: "sessions_send",
    description:
      "Send a message into another session. Use sessionKey or label to identify the target. If the target session is already actively streaming in this runtime, OpenClaw will queue the message into that run instead of starting a duplicate run.",
    parameters: SessionsSendToolSchema,
    invocationContract: SESSIONS_SEND_INVOCATION_CONTRACT,
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
        ["sessionKey", "sessionId", "label", "agentId", "message", "timeoutSeconds"],
        {
          label: "sessions_send",
        },
      );
      const message = readStringParam(params, "message", { required: true });
      const cfg = loadConfig();
      const { mainKey, alias } = resolveMainSessionAlias(cfg);
      const visibility = cfg.agents?.defaults?.sandbox?.sessionToolsVisibility ?? "spawned";
      const requesterInternalKey =
        typeof opts?.agentSessionKey === "string" && opts.agentSessionKey.trim()
          ? resolveInternalSessionKey({
              key: opts.agentSessionKey,
              alias,
              mainKey,
            })
          : undefined;
      const restrictToSpawned =
        opts?.sandboxed === true &&
        visibility === "spawned" &&
        !!requesterInternalKey &&
        !isSubagentSessionKey(requesterInternalKey);

      const a2aPolicy = createAgentToAgentPolicy(cfg);

      const sessionKeyParam = readAliasedStringParam(params, {
        primaryKey: "sessionKey",
        aliasKeys: ["sessionId"],
        label: "sessionKey",
      }).value;
      const labelParam = readStringParam(params, "label")?.trim() || undefined;
      const labelAgentIdParam = readStringParam(params, "agentId")?.trim() || undefined;
      if (sessionKeyParam && labelParam) {
        return jsonResult({
          runId: crypto.randomUUID(),
          status: "error",
          error: "Provide either sessionKey or label (not both).",
        });
      }

      const listSessions = async (listParams: Record<string, unknown>) => {
        const result = await callGateway<{ sessions: Array<{ key: string }> }>({
          method: "sessions.list",
          params: listParams,
          timeoutMs: 10_000,
        });
        return Array.isArray(result?.sessions) ? result.sessions : [];
      };

      let sessionKey = sessionKeyParam;
      if (!sessionKey && labelParam) {
        const requesterAgentId = requesterInternalKey
          ? resolveAgentIdFromSessionKey(requesterInternalKey)
          : undefined;
        const requestedAgentId = labelAgentIdParam
          ? normalizeAgentId(labelAgentIdParam)
          : undefined;

        if (
          restrictToSpawned &&
          requestedAgentId &&
          requesterAgentId &&
          requestedAgentId !== requesterAgentId
        ) {
          return jsonResult({
            runId: crypto.randomUUID(),
            status: "forbidden",
            error: "Sandboxed sessions_send label lookup is limited to this agent",
          });
        }

        if (requesterAgentId && requestedAgentId && requestedAgentId !== requesterAgentId) {
          if (!a2aPolicy.enabled) {
            return jsonResult({
              runId: crypto.randomUUID(),
              status: "forbidden",
              error:
                "Agent-to-agent messaging is disabled. Set tools.agentToAgent.enabled=true to allow cross-agent sends.",
            });
          }
          if (!a2aPolicy.isAllowed(requesterAgentId, requestedAgentId)) {
            return jsonResult({
              runId: crypto.randomUUID(),
              status: "forbidden",
              error: "Agent-to-agent messaging denied by tools.agentToAgent.allow.",
            });
          }
        }

        const resolveParams: Record<string, unknown> = {
          label: labelParam,
          ...(requestedAgentId ? { agentId: requestedAgentId } : {}),
          ...(restrictToSpawned ? { spawnedBy: requesterInternalKey } : {}),
        };
        let resolvedKey = "";
        try {
          const resolved = await callGateway<{ key: string }>({
            method: "sessions.resolve",
            params: resolveParams,
            timeoutMs: 10_000,
          });
          resolvedKey = typeof resolved?.key === "string" ? resolved.key.trim() : "";
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (restrictToSpawned) {
            return jsonResult({
              runId: crypto.randomUUID(),
              status: "forbidden",
              error: "Session not visible from this sandboxed agent session.",
            });
          }
          return jsonResult({
            runId: crypto.randomUUID(),
            status: "error",
            error: msg || `No session found with label: ${labelParam}`,
          });
        }

        if (!resolvedKey) {
          if (restrictToSpawned) {
            return jsonResult({
              runId: crypto.randomUUID(),
              status: "forbidden",
              error: "Session not visible from this sandboxed agent session.",
            });
          }
          return jsonResult({
            runId: crypto.randomUUID(),
            status: "error",
            error: `No session found with label: ${labelParam}`,
          });
        }
        sessionKey = resolvedKey;
      }

      if (!sessionKey) {
        return jsonResult({
          runId: crypto.randomUUID(),
          status: "error",
          error: "Either sessionKey or label is required",
        });
      }
      const resolvedSession = await resolveSessionReference({
        sessionKey,
        alias,
        mainKey,
        requesterInternalKey,
        restrictToSpawned,
      });
      if (!resolvedSession.ok) {
        return jsonResult({
          runId: crypto.randomUUID(),
          status: resolvedSession.status,
          error: resolvedSession.error,
        });
      }
      // Normalize sessionKey/sessionId input into a canonical session key.
      const resolvedKey = resolvedSession.key;
      const displayKey = resolvedSession.displayKey;
      const resolvedViaSessionId = resolvedSession.resolvedViaSessionId;

      if (restrictToSpawned && !resolvedViaSessionId) {
        const sessions = await listSessions({
          includeGlobal: false,
          includeUnknown: false,
          limit: 500,
          spawnedBy: requesterInternalKey,
        });
        const ok = sessions.some((entry) => entry?.key === resolvedKey);
        if (!ok) {
          return jsonResult({
            runId: crypto.randomUUID(),
            status: "forbidden",
            error: `Session not visible from this sandboxed agent session: ${sessionKey}`,
            sessionKey: displayKey,
          });
        }
      }
      const timeoutSeconds =
        typeof params.timeoutSeconds === "number" && Number.isFinite(params.timeoutSeconds)
          ? Math.max(0, Math.floor(params.timeoutSeconds))
          : 30;
      const timeoutMs = timeoutSeconds * 1000;
      const announceTimeoutMs = timeoutSeconds === 0 ? 30_000 : timeoutMs;
      const idempotencyKey = crypto.randomUUID();
      let runId: string = idempotencyKey;
      const requesterAgentId = resolveAgentIdFromSessionKey(requesterInternalKey);
      const runtimeTarget = resolveRuntimeTargetSession(resolvedKey);
      const targetSessionKey = runtimeTarget.sessionKey;
      const targetSessionId = runtimeTarget.sessionId;
      const targetAgentId = resolveAgentIdFromSessionKey(targetSessionKey);
      const isCrossAgent = requesterAgentId !== targetAgentId;
      if (isCrossAgent) {
        if (!a2aPolicy.enabled) {
          return jsonResult({
            runId: crypto.randomUUID(),
            status: "forbidden",
            error:
              "Agent-to-agent messaging is disabled. Set tools.agentToAgent.enabled=true to allow cross-agent sends.",
            sessionKey: displayKey,
          });
        }
        if (!a2aPolicy.isAllowed(requesterAgentId, targetAgentId)) {
          return jsonResult({
            runId: crypto.randomUUID(),
            status: "forbidden",
            error: "Agent-to-agent messaging denied by tools.agentToAgent.allow.",
            sessionKey: displayKey,
          });
        }
      }

      const agentMessageContext = buildAgentToAgentMessageContext({
        requesterSessionKey: opts?.agentSessionKey,
        requesterChannel: opts?.agentChannel,
        targetSessionKey: displayKey,
      });
      const sendParams = {
        message,
        sessionKey: targetSessionKey,
        idempotencyKey,
        deliver: false,
        channel: INTERNAL_MESSAGE_CHANNEL,
        lane: AGENT_LANE_NESTED,
        extraSystemPrompt: agentMessageContext,
      };
      const requesterSessionKey = opts?.agentSessionKey;
      const requesterChannel = opts?.agentChannel;
      const maxPingPongTurns = resolvePingPongTurns(cfg);
      const delivery = { status: "pending", mode: "announce" as const };
      const startA2AFlow = (roundOneReply?: string, waitRunId?: string) => {
        void runSessionsSendA2AFlow({
          targetSessionKey,
          displayKey,
          message,
          announceTimeoutMs,
          maxPingPongTurns,
          requesterSessionKey,
          requesterChannel,
          roundOneReply,
          waitRunId,
        });
      };
      const resolveQueuedReply = async (previousReply?: string) => {
        const latestReply = await readLatestAssistantReply({
          sessionKey: targetSessionKey,
        }).catch(() => undefined);
        if (!latestReply || latestReply === previousReply) {
          return undefined;
        }
        return latestReply;
      };

      if (targetSessionId && isEmbeddedPiRunActive(targetSessionId)) {
        const previousReply = await readLatestAssistantReply({
          sessionKey: targetSessionKey,
        }).catch(() => undefined);
        if (queueEmbeddedPiMessage(targetSessionId, message)) {
          const queuedDelivery = { status: "queued", mode: "active-run" as const };
          const awaitQueuedReply = async (waitMs: number) => {
            const settled = await waitForEmbeddedPiRunEnd(targetSessionId, waitMs);
            if (!settled) {
              return { settled: false as const, reply: undefined };
            }
            return {
              settled: true as const,
              reply: await resolveQueuedReply(previousReply),
            };
          };

          if (timeoutSeconds === 0) {
            void (async () => {
              const queued = await awaitQueuedReply(announceTimeoutMs);
              if (queued.settled && queued.reply) {
                startA2AFlow(queued.reply);
              }
            })();
            return jsonResult({
              runId,
              status: "accepted",
              sessionKey: displayKey,
              delivery: queuedDelivery,
            });
          }

          const queued = await awaitQueuedReply(timeoutMs);
          if (!queued.settled) {
            return jsonResult({
              runId,
              status: "timeout",
              error: "Timed out waiting for the active target session to finish queued work.",
              sessionKey: displayKey,
              delivery: queuedDelivery,
            });
          }
          if (queued.reply) {
            startA2AFlow(queued.reply);
          }
          return jsonResult({
            runId,
            status: "ok",
            reply: queued.reply,
            sessionKey: displayKey,
            delivery: queuedDelivery,
          });
        }
      }

      if (timeoutSeconds === 0) {
        try {
          const response = await callGateway<{ runId: string }>({
            method: "agent",
            params: sendParams,
            timeoutMs: 10_000,
          });
          if (typeof response?.runId === "string" && response.runId) {
            runId = response.runId;
          }
          startA2AFlow(undefined, runId);
          return jsonResult({
            runId,
            status: "accepted",
            sessionKey: displayKey,
            delivery,
          });
        } catch (err) {
          const messageText =
            err instanceof Error ? err.message : typeof err === "string" ? err : "error";
          return jsonResult({
            runId,
            status: "error",
            error: messageText,
            sessionKey: displayKey,
          });
        }
      }

      try {
        const response = await callGateway<{ runId: string }>({
          method: "agent",
          params: sendParams,
          timeoutMs: 10_000,
        });
        if (typeof response?.runId === "string" && response.runId) {
          runId = response.runId;
        }
      } catch (err) {
        const messageText =
          err instanceof Error ? err.message : typeof err === "string" ? err : "error";
        return jsonResult({
          runId,
          status: "error",
          error: messageText,
          sessionKey: displayKey,
        });
      }

      let waitStatus: string | undefined;
      let waitError: string | undefined;
      try {
        const wait = await callGateway<{ status?: string; error?: string }>({
          method: "agent.wait",
          params: {
            runId,
            timeoutMs,
          },
          timeoutMs: timeoutMs + 2000,
        });
        waitStatus = typeof wait?.status === "string" ? wait.status : undefined;
        waitError = typeof wait?.error === "string" ? wait.error : undefined;
      } catch (err) {
        const messageText =
          err instanceof Error ? err.message : typeof err === "string" ? err : "error";
        return jsonResult({
          runId,
          status: messageText.includes("gateway timeout") ? "timeout" : "error",
          error: messageText,
          sessionKey: displayKey,
        });
      }

      if (waitStatus === "timeout") {
        return jsonResult({
          runId,
          status: "timeout",
          error: waitError,
          sessionKey: displayKey,
        });
      }
      if (waitStatus === "error") {
        return jsonResult({
          runId,
          status: "error",
          error: waitError ?? "agent error",
          sessionKey: displayKey,
        });
      }

      const reply = await readLatestAssistantReply({
        sessionKey: targetSessionKey,
      }).catch(() => undefined);
      startA2AFlow(reply ?? undefined);

      return jsonResult({
        runId,
        status: "ok",
        reply,
        sessionKey: displayKey,
        delivery,
      });
    },
  };
}
