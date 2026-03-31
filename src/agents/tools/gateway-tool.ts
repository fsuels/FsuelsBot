import { Type } from "@sinclair/typebox";
import type { OpenClawConfig } from "../../config/config.js";
import type { ToolInvocationContract } from "../tool-contract.js";
import { loadConfig, resolveConfigSnapshotHash } from "../../config/io.js";
import { loadSessionStore, resolveStorePath } from "../../config/sessions.js";
import {
  formatDoctorNonInteractiveHint,
  type RestartSentinelPayload,
  writeRestartSentinel,
} from "../../infra/restart-sentinel.js";
import { scheduleGatewaySigusr1Restart } from "../../infra/restart.js";
import { stringEnum } from "../schema/typebox.js";
import { validateFlatActionInput, type ActionValidationRule } from "./action-validation.js";
import { type AnyAgentTool, jsonResult, readStringParam } from "./common.js";
import { callGatewayTool } from "./gateway.js";

const DEFAULT_UPDATE_TIMEOUT_MS = 20 * 60_000;

function resolveBaseHashFromSnapshot(snapshot: unknown): string | undefined {
  if (!snapshot || typeof snapshot !== "object") {
    return undefined;
  }
  const hashValue = (snapshot as { hash?: unknown }).hash;
  const rawValue = (snapshot as { raw?: unknown }).raw;
  const hash = resolveConfigSnapshotHash({
    hash: typeof hashValue === "string" ? hashValue : undefined,
    raw: typeof rawValue === "string" ? rawValue : undefined,
  });
  return hash ?? undefined;
}

const GATEWAY_ACTIONS = [
  "restart",
  "config.get",
  "config.schema",
  "config.apply",
  "config.patch",
  "update.run",
] as const;

// NOTE: Using a flattened object schema instead of Type.Union([Type.Object(...), ...])
// because Claude API on Vertex AI rejects nested anyOf schemas as invalid JSON Schema.
// The discriminator (action) determines which properties are relevant; runtime validates.
const GatewayToolSchema = Type.Object({
  action: stringEnum(GATEWAY_ACTIONS),
  // restart
  delayMs: Type.Optional(Type.Number()),
  reason: Type.Optional(Type.String()),
  // config.get, config.schema, config.apply, update.run
  gatewayUrl: Type.Optional(Type.String()),
  gatewayToken: Type.Optional(Type.String()),
  timeoutMs: Type.Optional(Type.Number()),
  // config.apply, config.patch
  raw: Type.Optional(Type.String()),
  baseHash: Type.Optional(Type.String()),
  // config.apply, config.patch, update.run
  sessionKey: Type.Optional(Type.String()),
  note: Type.Optional(Type.String()),
  restartDelayMs: Type.Optional(Type.Number()),
});
// NOTE: We intentionally avoid top-level `allOf`/`anyOf`/`oneOf` conditionals here:
// - OpenAI rejects tool schemas that include these keywords at the *top-level*.
// - Claude/Vertex has other JSON Schema quirks.
// Conditional requirements (like `raw` for config.apply) are enforced at runtime.

const GATEWAY_ACTION_RULES: Record<string, ActionValidationRule> = {
  restart: {},
  "config.get": {},
  "config.schema": {},
  "config.apply": {
    required: ["raw"],
  },
  "config.patch": {
    required: ["raw"],
  },
  "update.run": {},
};

const GATEWAY_TOOL_INVOCATION_CONTRACT: ToolInvocationContract = {
  usagePolicy: "explicit_only",
  sideEffectLevel: "high",
  whenToUse: [
    "The user explicitly asks to restart OpenClaw, inspect/apply config, or run a self-update.",
    "You need the gateway config schema or current config as part of an explicit config task.",
  ],
  whenNotToUse: [
    "Do not use gateway actions for ordinary coding or debugging inside the workspace.",
    "Do not infer restart/config/update actions from a generic request to fix a bug.",
    "Do not use config.apply for a partial config change when config.patch is sufficient.",
  ],
  preconditions: [
    "restart requires commands.restart=true.",
    "config.apply and config.patch require raw config text.",
    "Be clear whether you are reading config, patching part of it, replacing all of it, or updating the running gateway.",
  ],
  behaviorSummary:
    "Calls gateway control endpoints to restart the process, inspect schema/config, apply config writes, or run in-place updates.",
  parametersSummary: [
    "action: restart, config.get, config.schema, config.apply, config.patch, or update.run.",
    "raw: required config payload for config.apply/config.patch.",
    "note and sessionKey: optional restart/update context for follow-up delivery.",
    "delayMs or restartDelayMs: optional restart timing controls.",
    "gatewayUrl, gatewayToken, timeoutMs: optional explicit gateway connection overrides.",
  ],
};

export function createGatewayTool(opts?: {
  agentSessionKey?: string;
  config?: OpenClawConfig;
}): AnyAgentTool {
  return {
    label: "Gateway",
    name: "gateway",
    description:
      "Restart, apply config, or update the gateway in-place (SIGUSR1). Use config.patch for safe partial config updates (merges with existing). Use config.apply only when replacing entire config. Both trigger restart after writing.",
    parameters: GatewayToolSchema,
    invocationContract: GATEWAY_TOOL_INVOCATION_CONTRACT,
    validateInput: async (input, _context) =>
      validateFlatActionInput({
        toolName: "gateway",
        action: typeof input.action === "string" ? input.action : "",
        input: input as Record<string, unknown>,
        rules: GATEWAY_ACTION_RULES,
      }),
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });
      if (action === "restart") {
        if (opts?.config?.commands?.restart !== true) {
          throw new Error("Gateway restart is disabled. Set commands.restart=true to enable.");
        }
        const sessionKey =
          typeof params.sessionKey === "string" && params.sessionKey.trim()
            ? params.sessionKey.trim()
            : opts?.agentSessionKey?.trim() || undefined;
        const delayMs =
          typeof params.delayMs === "number" && Number.isFinite(params.delayMs)
            ? Math.floor(params.delayMs)
            : undefined;
        const reason =
          typeof params.reason === "string" && params.reason.trim()
            ? params.reason.trim().slice(0, 200)
            : undefined;
        const note =
          typeof params.note === "string" && params.note.trim() ? params.note.trim() : undefined;
        // Extract channel + threadId for routing after restart
        let deliveryContext: { channel?: string; to?: string; accountId?: string } | undefined;
        let threadId: string | undefined;
        if (sessionKey) {
          const threadMarker = ":thread:";
          const threadIndex = sessionKey.lastIndexOf(threadMarker);
          const baseSessionKey = threadIndex === -1 ? sessionKey : sessionKey.slice(0, threadIndex);
          const threadIdRaw =
            threadIndex === -1 ? undefined : sessionKey.slice(threadIndex + threadMarker.length);
          threadId = threadIdRaw?.trim() || undefined;
          try {
            const cfg = loadConfig();
            const storePath = resolveStorePath(cfg.session?.store);
            const store = loadSessionStore(storePath);
            let entry = store[sessionKey];
            if (!entry?.deliveryContext && threadIndex !== -1 && baseSessionKey) {
              entry = store[baseSessionKey];
            }
            if (entry?.deliveryContext) {
              deliveryContext = {
                channel: entry.deliveryContext.channel,
                to: entry.deliveryContext.to,
                accountId: entry.deliveryContext.accountId,
              };
            }
          } catch {
            // ignore: best-effort
          }
        }
        const payload: RestartSentinelPayload = {
          kind: "restart",
          status: "ok",
          ts: Date.now(),
          sessionKey,
          deliveryContext,
          threadId,
          message: note ?? reason ?? null,
          doctorHint: formatDoctorNonInteractiveHint(),
          stats: {
            mode: "gateway.restart",
            reason,
          },
        };
        try {
          await writeRestartSentinel(payload);
        } catch {
          // ignore: sentinel is best-effort
        }
        console.info(
          `gateway tool: restart requested (delayMs=${delayMs ?? "default"}, reason=${reason ?? "none"})`,
        );
        const scheduled = scheduleGatewaySigusr1Restart({
          delayMs,
          reason,
        });
        return jsonResult(scheduled);
      }

      const gatewayUrl =
        typeof params.gatewayUrl === "string" && params.gatewayUrl.trim()
          ? params.gatewayUrl.trim()
          : undefined;
      const gatewayToken =
        typeof params.gatewayToken === "string" && params.gatewayToken.trim()
          ? params.gatewayToken.trim()
          : undefined;
      const timeoutMs =
        typeof params.timeoutMs === "number" && Number.isFinite(params.timeoutMs)
          ? Math.max(1, Math.floor(params.timeoutMs))
          : undefined;
      const gatewayOpts = { gatewayUrl, gatewayToken, timeoutMs };

      if (action === "config.get") {
        const result = await callGatewayTool("config.get", gatewayOpts, {});
        return jsonResult({ ok: true, result });
      }
      if (action === "config.schema") {
        const result = await callGatewayTool("config.schema", gatewayOpts, {});
        return jsonResult({ ok: true, result });
      }
      if (action === "config.apply") {
        const raw = readStringParam(params, "raw", { required: true });
        let baseHash = readStringParam(params, "baseHash");
        if (!baseHash) {
          const snapshot = await callGatewayTool("config.get", gatewayOpts, {});
          baseHash = resolveBaseHashFromSnapshot(snapshot);
        }
        const sessionKey =
          typeof params.sessionKey === "string" && params.sessionKey.trim()
            ? params.sessionKey.trim()
            : opts?.agentSessionKey?.trim() || undefined;
        const note =
          typeof params.note === "string" && params.note.trim() ? params.note.trim() : undefined;
        const restartDelayMs =
          typeof params.restartDelayMs === "number" && Number.isFinite(params.restartDelayMs)
            ? Math.floor(params.restartDelayMs)
            : undefined;
        const result = await callGatewayTool("config.apply", gatewayOpts, {
          raw,
          baseHash,
          sessionKey,
          note,
          restartDelayMs,
        });
        return jsonResult({ ok: true, result });
      }
      if (action === "config.patch") {
        const raw = readStringParam(params, "raw", { required: true });
        let baseHash = readStringParam(params, "baseHash");
        if (!baseHash) {
          const snapshot = await callGatewayTool("config.get", gatewayOpts, {});
          baseHash = resolveBaseHashFromSnapshot(snapshot);
        }
        const sessionKey =
          typeof params.sessionKey === "string" && params.sessionKey.trim()
            ? params.sessionKey.trim()
            : opts?.agentSessionKey?.trim() || undefined;
        const note =
          typeof params.note === "string" && params.note.trim() ? params.note.trim() : undefined;
        const restartDelayMs =
          typeof params.restartDelayMs === "number" && Number.isFinite(params.restartDelayMs)
            ? Math.floor(params.restartDelayMs)
            : undefined;
        const result = await callGatewayTool("config.patch", gatewayOpts, {
          raw,
          baseHash,
          sessionKey,
          note,
          restartDelayMs,
        });
        return jsonResult({ ok: true, result });
      }
      if (action === "update.run") {
        const sessionKey =
          typeof params.sessionKey === "string" && params.sessionKey.trim()
            ? params.sessionKey.trim()
            : opts?.agentSessionKey?.trim() || undefined;
        const note =
          typeof params.note === "string" && params.note.trim() ? params.note.trim() : undefined;
        const restartDelayMs =
          typeof params.restartDelayMs === "number" && Number.isFinite(params.restartDelayMs)
            ? Math.floor(params.restartDelayMs)
            : undefined;
        const updateGatewayOpts = {
          ...gatewayOpts,
          timeoutMs: timeoutMs ?? DEFAULT_UPDATE_TIMEOUT_MS,
        };
        const result = await callGatewayTool("update.run", updateGatewayOpts, {
          sessionKey,
          note,
          restartDelayMs,
          timeoutMs: timeoutMs ?? DEFAULT_UPDATE_TIMEOUT_MS,
        });
        return jsonResult({ ok: true, result });
      }

      throw new Error(`Unknown action: ${action}`);
    },
  };
}
