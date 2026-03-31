import { Type } from "@sinclair/typebox";
import type { OpenClawConfig } from "../../config/config.js";
import { defineOpenClawTool, toolValidationError, toolValidationOk } from "../tool-contract.js";
import { registerSleep } from "../sleep-registry.js";
import { jsonResult, readNumberParam, readStringOrNumberParam, readStringParam } from "./common.js";

const SleepToolSchema = Type.Object(
  {
    durationMs: Type.Optional(
      Type.Number({
        description: "How long to sleep in milliseconds.",
      }),
    ),
    until: Type.Optional(
      Type.Union([
        Type.String({
          description: "Future ISO timestamp to wake at.",
        }),
        Type.Number({
          description: "Future epoch timestamp in milliseconds to wake at.",
        }),
      ]),
    ),
    reason: Type.Optional(
      Type.String({
        description: "Short note about what you are waiting for.",
      }),
    ),
    interruptible: Type.Optional(
      Type.Boolean({
        description: "Wake early when new work arrives. Defaults to true.",
      }),
    ),
  },
  { additionalProperties: false },
);

type NormalizedSleepInput = {
  wakeAt: number;
  requestedDurationMs: number;
  reason?: string;
  interruptible: boolean;
};

function normalizeSleepInput(input: Record<string, unknown>): NormalizedSleepInput {
  const durationMs = readNumberParam(input, "durationMs", { integer: true });
  const untilRaw = readStringOrNumberParam(input, "until");

  if ((durationMs === undefined && untilRaw === undefined) || (durationMs !== undefined && untilRaw)) {
    throw new Error("Provide exactly one of durationMs or until.");
  }

  const now = Date.now();
  let wakeAt: number;
  let requestedDurationMs: number;
  if (durationMs !== undefined) {
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      throw new Error("durationMs must be a positive number.");
    }
    requestedDurationMs = Math.floor(durationMs);
    wakeAt = now + requestedDurationMs;
  } else {
    const untilAsNumber = Number(untilRaw);
    if (Number.isFinite(untilAsNumber)) {
      wakeAt = Math.floor(untilAsNumber);
    } else {
      const parsed = Date.parse(String(untilRaw));
      if (!Number.isFinite(parsed)) {
        throw new Error("until must be a future ISO timestamp or epoch milliseconds.");
      }
      wakeAt = Math.floor(parsed);
    }
    requestedDurationMs = wakeAt - now;
    if (requestedDurationMs <= 0) {
      throw new Error("until must be in the future.");
    }
  }

  return {
    wakeAt,
    requestedDurationMs,
    reason: readStringParam(input, "reason"),
    interruptible:
      typeof input.interruptible === "boolean" ? input.interruptible : true,
  };
}

export function createSleepTool(opts?: {
  agentSessionKey?: string;
  config?: OpenClawConfig;
}) {
  return defineOpenClawTool({
    name: "sleep",
    label: "Sleep",
    description:
      "Register a non-blocking wait for this session. Prefer this over shell sleep, timeout, or polling loops when you need to wait.",
    parameters: SleepToolSchema,
    inputSchema: SleepToolSchema,
    isConcurrencySafe: () => true,
    validateInput: async (input, _context) => {
      try {
        normalizeSleepInput(input as Record<string, unknown>);
        return toolValidationOk();
      } catch (error) {
        return toolValidationError({
          code: "invalid_input",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
    execute: async (_toolCallId, args) => {
      const sessionKey = opts?.agentSessionKey?.trim();
      if (!sessionKey) {
        throw new Error("sleep is only available inside an active agent session.");
      }
      const normalized = normalizeSleepInput(args as Record<string, unknown>);
      const registered = registerSleep({
        sessionKey,
        wakeAt: normalized.wakeAt,
        reason: normalized.reason,
        interruptible: normalized.interruptible,
        config: opts?.config,
      });

      return jsonResult({
        ok: true,
        status: "scheduled",
        sessionKey,
        sleepId: registered.sleepId,
        reason: normalized.reason,
        interruptible: normalized.interruptible,
        requestedDurationMs: normalized.requestedDurationMs,
        effectiveDurationMs: registered.durationMs,
        requestedWakeAt: new Date(registered.requestedWakeAt).toISOString(),
        wakeAt: new Date(registered.wakeAt).toISOString(),
        tickIntervalMs: registered.tickIntervalMs,
        clamped: registered.clamped,
        persistence: registered.persistence,
        heuristics: registered.heuristics,
      });
    },
  });
}
