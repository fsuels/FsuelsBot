import { randomUUID } from "node:crypto";
import type { SessionEntry } from "../../config/sessions.js";
import type { CommandHandler } from "./commands-types.js";
import { isCliProvider } from "../../agents/model-selection.js";
import { abortEmbeddedPiRun } from "../../agents/pi-embedded.js";
import {
  DEFAULT_PLAN_MODE_PROFILE,
  applyCollaborationModeTransition,
  formatPlanModeStatusLine,
  normalizePlanModeProfile,
  resolveSessionCollaborationMode,
} from "../../agents/plan-mode.js";
import { updateSessionStore } from "../../config/sessions.js";
import { logVerbose } from "../../globals.js";
import { createInternalHookEvent, triggerInternalHook } from "../../hooks/internal-hooks.js";
import { scheduleGatewaySigusr1Restart, triggerOpenClawRestart } from "../../infra/restart.js";
import { loadCostUsageSummary, loadSessionCostSummary } from "../../infra/session-cost-usage.js";
import { loadSessionPlanArtifact } from "../../infra/session-plan.js";
import { resolveAgentIdFromSessionKey, isSubagentSessionKey } from "../../routing/session-key.js";
import { formatTokenCount, formatUsd } from "../../utils/usage-format.js";
import { parseActivationCommand } from "../group-activation.js";
import { parseSendPolicyCommand } from "../send-policy.js";
import { normalizeUsageDisplay, resolveResponseUsageMode } from "../thinking.js";
import {
  formatAbortReplyText,
  isAbortTrigger,
  setAbortMemory,
  stopSubagentsForRequester,
} from "./abort.js";
import { applySessionEntryMutation } from "./commands-session-state.js";
import { clearSessionQueues } from "./queue.js";

function resolveSessionEntryForKey(
  store: Record<string, SessionEntry> | undefined,
  sessionKey: string | undefined,
) {
  if (!store || !sessionKey) {
    return {};
  }
  const direct = store[sessionKey];
  if (direct) {
    return { entry: direct, key: sessionKey };
  }
  return {};
}

function resolveAbortTarget(params: {
  ctx: { CommandTargetSessionKey?: string | null };
  sessionKey?: string;
  sessionEntry?: SessionEntry;
  sessionStore?: Record<string, SessionEntry>;
}) {
  const targetSessionKey = params.ctx.CommandTargetSessionKey?.trim() || params.sessionKey;
  const { entry, key } = resolveSessionEntryForKey(params.sessionStore, targetSessionKey);
  if (entry && key) {
    return { entry, key, sessionId: entry.sessionId };
  }
  if (params.sessionEntry && params.sessionKey) {
    return {
      entry: params.sessionEntry,
      key: params.sessionKey,
      sessionId: params.sessionEntry.sessionId,
    };
  }
  return { entry: undefined, key: targetSessionKey, sessionId: undefined };
}

type PlanCommandState =
  | { kind: "enter"; profile: "proactive" | "conservative"; description?: string }
  | { kind: "exit" }
  | { kind: "open" }
  | { kind: "status" }
  | { kind: "show" }
  | { kind: "invalid" };

function parsePlanCommandState(
  normalized: string,
  planModeActive: boolean,
): PlanCommandState | null {
  if (normalized !== "/plan" && !normalized.startsWith("/plan ")) {
    return null;
  }
  const rawArgs = normalized === "/plan" ? "" : normalized.slice("/plan".length).trim();
  if (!rawArgs) {
    return planModeActive
      ? { kind: "show" }
      : { kind: "enter", profile: DEFAULT_PLAN_MODE_PROFILE };
  }
  const parts = rawArgs.split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return planModeActive
      ? { kind: "show" }
      : { kind: "enter", profile: DEFAULT_PLAN_MODE_PROFILE };
  }

  const first = parts[0]?.trim().toLowerCase();
  if (first === "status") {
    return parts.length === 1 ? { kind: "status" } : { kind: "invalid" };
  }
  if (first === "open") {
    return parts.length === 1 ? { kind: "open" } : { kind: "invalid" };
  }
  if (first === "off" || first === "exit" || first === "stop") {
    return parts.length === 1 ? { kind: "exit" } : { kind: "invalid" };
  }
  if (first === "on" || first === "enter" || first === "start") {
    const maybeProfile = normalizePlanModeProfile(parts[1]);
    const description =
      parts
        .slice(maybeProfile ? 2 : 1)
        .join(" ")
        .trim() || undefined;
    return {
      kind: "enter",
      profile: maybeProfile ?? DEFAULT_PLAN_MODE_PROFILE,
      description,
    };
  }
  const directProfile = normalizePlanModeProfile(first);
  if (directProfile) {
    return {
      kind: "enter",
      profile: directProfile,
      description: parts.slice(1).join(" ").trim() || undefined,
    };
  }
  return {
    kind: "enter",
    profile: DEFAULT_PLAN_MODE_PROFILE,
    description: rawArgs,
  };
}

async function ensureSessionEntry(params: {
  sessionEntry?: SessionEntry;
  sessionStore?: Record<string, SessionEntry>;
  sessionKey?: string;
  storePath?: string;
}): Promise<SessionEntry | undefined> {
  if (params.sessionEntry || !params.sessionStore || !params.sessionKey) {
    return params.sessionEntry;
  }
  const created: SessionEntry = {
    sessionId: randomUUID(),
    updatedAt: Date.now(),
  };
  params.sessionStore[params.sessionKey] = created;
  if (params.storePath) {
    await updateSessionStore(params.storePath, (store) => {
      store[params.sessionKey as string] = created;
    });
  }
  return created;
}

function buildPlanContinuationBody(params: { description: string; currentPlan?: string }): string {
  const currentPlan = params.currentPlan?.trim();
  return [
    currentPlan
      ? "Refine the current session plan using the request below."
      : "Draft a concrete implementation plan for the request below.",
    currentPlan ? `Current saved plan:\n${currentPlan}` : null,
    `Planning request:\n${params.description.trim()}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function formatCurrentPlanReply(params: {
  modeLine: string;
  filePath: string;
  updatedAt?: string;
  plan: string;
  exists: boolean;
}): string {
  const lines = [params.modeLine, `Artifact: ${params.filePath}`];
  if (params.updatedAt) {
    lines.push(`Updated: ${params.updatedAt}`);
  }
  const plan = params.plan.trim();
  if (!params.exists || !plan) {
    lines.push("No saved plan yet. Use `/plan <description>` to draft or refine one.");
    return lines.join("\n");
  }
  return [...lines, "", plan].join("\n");
}

export const handleActivationCommand: CommandHandler = async (params, allowTextCommands) => {
  if (!allowTextCommands) {
    return null;
  }
  const activationCommand = parseActivationCommand(params.command.commandBodyNormalized);
  if (!activationCommand.hasCommand) {
    return null;
  }
  if (!params.isGroup) {
    return {
      shouldContinue: false,
      reply: { text: "⚙️ Group activation only applies to group chats." },
    };
  }
  if (!params.command.isAuthorizedSender) {
    logVerbose(
      `Ignoring /activation from unauthorized sender in group: ${params.command.senderId || "<unknown>"}`,
    );
    return { shouldContinue: false };
  }
  if (!activationCommand.mode) {
    return {
      shouldContinue: false,
      reply: { text: "⚙️ Usage: /activation mention|always" },
    };
  }
  await applySessionEntryMutation({
    entry: params.sessionEntry,
    sessionStore: params.sessionStore,
    sessionKey: params.sessionKey,
    storePath: params.storePath,
    mutate: (entry) => {
      entry.groupActivation = activationCommand.mode;
      entry.groupActivationNeedsSystemIntro = true;
    },
  });
  return {
    shouldContinue: false,
    reply: {
      text: `⚙️ Group activation set to ${activationCommand.mode}.`,
    },
  };
};

export const handleSendPolicyCommand: CommandHandler = async (params, allowTextCommands) => {
  if (!allowTextCommands) {
    return null;
  }
  const sendPolicyCommand = parseSendPolicyCommand(params.command.commandBodyNormalized);
  if (!sendPolicyCommand.hasCommand) {
    return null;
  }
  if (!params.command.isAuthorizedSender) {
    logVerbose(
      `Ignoring /send from unauthorized sender: ${params.command.senderId || "<unknown>"}`,
    );
    return { shouldContinue: false };
  }
  if (!sendPolicyCommand.mode) {
    return {
      shouldContinue: false,
      reply: { text: "⚙️ Usage: /send on|off|inherit" },
    };
  }
  await applySessionEntryMutation({
    entry: params.sessionEntry,
    sessionStore: params.sessionStore,
    sessionKey: params.sessionKey,
    storePath: params.storePath,
    mutate: (entry) => {
      if (sendPolicyCommand.mode === "inherit") {
        delete entry.sendPolicy;
      } else {
        entry.sendPolicy = sendPolicyCommand.mode;
      }
    },
  });
  const label =
    sendPolicyCommand.mode === "inherit"
      ? "inherit"
      : sendPolicyCommand.mode === "allow"
        ? "on"
        : "off";
  return {
    shouldContinue: false,
    reply: { text: `⚙️ Send policy set to ${label}.` },
  };
};

export const handlePlanCommand: CommandHandler = async (params, allowTextCommands) => {
  if (!allowTextCommands) {
    return null;
  }
  const currentMode = resolveSessionCollaborationMode(params.sessionEntry);
  const requested = parsePlanCommandState(
    params.command.commandBodyNormalized,
    currentMode === "plan",
  );
  if (!requested) {
    return null;
  }
  if (!params.command.isAuthorizedSender) {
    logVerbose(
      `Ignoring /plan from unauthorized sender: ${params.command.senderId || "<unknown>"}`,
    );
    return { shouldContinue: false };
  }

  if (requested.kind === "invalid") {
    return {
      shouldContinue: false,
      reply: {
        text: "⚙️ Usage: /plan [status|open|off|on|proactive|conservative|<description>]",
      },
    };
  }

  if (requested.kind === "status") {
    return {
      shouldContinue: false,
      reply: { text: formatPlanModeStatusLine(params.sessionEntry) },
    };
  }

  if (!params.sessionKey || isSubagentSessionKey(params.sessionKey)) {
    return {
      shouldContinue: false,
      reply: {
        text: "⚠️ /plan is only available in top-level sessions because subagents do not have a safe local exit path.",
      },
    };
  }

  const agentId = resolveAgentIdFromSessionKey(params.sessionKey);
  const existingSessionEntry = params.sessionEntry;
  const planArtifact = existingSessionEntry?.sessionId
    ? await loadSessionPlanArtifact({
        sessionId: existingSessionEntry.sessionId,
        sessionEntry: existingSessionEntry,
        sessionKey: params.sessionKey,
        agentId,
      })
    : undefined;

  if (requested.kind === "show") {
    return {
      shouldContinue: false,
      reply: {
        text: formatCurrentPlanReply({
          modeLine: formatPlanModeStatusLine(existingSessionEntry),
          filePath: planArtifact?.filePath ?? "(plan artifact unavailable)",
          updatedAt: planArtifact?.updatedAt,
          plan: planArtifact?.plan ?? "",
          exists: planArtifact?.exists === true,
        }),
      },
    };
  }

  if (requested.kind === "open") {
    const filePath = planArtifact?.filePath ?? "(plan artifact unavailable)";
    return {
      shouldContinue: false,
      reply: {
        text:
          "🗺️ External editor integration is not configured for session plans in this runtime.\n" +
          `Artifact: ${filePath}`,
      },
    };
  }

  if (requested.kind === "enter" && isCliProvider(params.provider, params.cfg)) {
    return {
      shouldContinue: false,
      reply: {
        text: "⚠️ /plan is not available with CLI providers yet because OpenClaw cannot hard-enforce read-only behavior there. Switch to an embedded model or stay in execution mode.",
      },
    };
  }

  const sessionEntry = await ensureSessionEntry({
    sessionEntry: existingSessionEntry,
    sessionStore: params.sessionStore,
    sessionKey: params.sessionKey,
    storePath: params.storePath,
  });
  if (sessionEntry && !params.sessionEntry) {
    params.sessionEntry = sessionEntry;
  }

  const nextTransition =
    requested.kind === "exit"
      ? { mode: "default" as const }
      : { mode: "plan" as const, planProfile: requested.profile };
  await applySessionEntryMutation({
    entry: sessionEntry,
    sessionStore: params.sessionStore,
    sessionKey: params.sessionKey,
    storePath: params.storePath,
    mutate: (entry) => {
      const transitioned = applyCollaborationModeTransition(entry, nextTransition).entry;
      if (transitioned.collaborationMode === "plan") {
        entry.collaborationMode = "plan";
        entry.planProfile = transitioned.planProfile;
      } else {
        delete entry.collaborationMode;
        delete entry.planProfile;
      }
    },
  });

  if (requested.kind === "enter" && requested.description?.trim()) {
    return {
      shouldContinue: true,
      continueWithBody: buildPlanContinuationBody({
        description: requested.description,
        currentPlan: planArtifact?.plan,
      }),
    };
  }

  return requested.kind === "exit"
    ? {
        shouldContinue: false,
        reply: {
          text: "🗺️ Plan mode disabled. Normal execution is restored for this session.",
        },
      }
    : {
        shouldContinue: false,
        reply: {
          text:
            `🗺️ Plan mode enabled (${requested.profile}). ` +
            "I will stay read-only, inspect the codebase, and return a concrete implementation plan. " +
            "Exit with /plan off.",
        },
      };
};

export const handleUsageCommand: CommandHandler = async (params, allowTextCommands) => {
  if (!allowTextCommands) {
    return null;
  }
  const normalized = params.command.commandBodyNormalized;
  if (normalized !== "/usage" && !normalized.startsWith("/usage ")) {
    return null;
  }
  if (!params.command.isAuthorizedSender) {
    logVerbose(
      `Ignoring /usage from unauthorized sender: ${params.command.senderId || "<unknown>"}`,
    );
    return { shouldContinue: false };
  }

  const rawArgs = normalized === "/usage" ? "" : normalized.slice("/usage".length).trim();
  const requested = rawArgs ? normalizeUsageDisplay(rawArgs) : undefined;
  if (rawArgs.toLowerCase().startsWith("cost")) {
    const sessionSummary = await loadSessionCostSummary({
      sessionId: params.sessionEntry?.sessionId,
      sessionEntry: params.sessionEntry,
      sessionFile: params.sessionEntry?.sessionFile,
      config: params.cfg,
    });
    const summary = await loadCostUsageSummary({ days: 30, config: params.cfg });

    const sessionCost = formatUsd(sessionSummary?.totalCost);
    const sessionTokens = sessionSummary?.totalTokens
      ? formatTokenCount(sessionSummary.totalTokens)
      : undefined;
    const sessionMissing = sessionSummary?.missingCostEntries ?? 0;
    const sessionSuffix = sessionMissing > 0 ? " (partial)" : "";
    const sessionLine =
      sessionCost || sessionTokens
        ? `Session ${sessionCost ?? "n/a"}${sessionSuffix}${sessionTokens ? ` · ${sessionTokens} tokens` : ""}`
        : "Session n/a";

    const todayKey = new Date().toLocaleDateString("en-CA");
    const todayEntry = summary.daily.find((entry) => entry.date === todayKey);
    const todayCost = formatUsd(todayEntry?.totalCost);
    const todayMissing = todayEntry?.missingCostEntries ?? 0;
    const todaySuffix = todayMissing > 0 ? " (partial)" : "";
    const todayLine = `Today ${todayCost ?? "n/a"}${todaySuffix}`;

    const last30Cost = formatUsd(summary.totals.totalCost);
    const last30Missing = summary.totals.missingCostEntries;
    const last30Suffix = last30Missing > 0 ? " (partial)" : "";
    const last30Line = `Last 30d ${last30Cost ?? "n/a"}${last30Suffix}`;

    return {
      shouldContinue: false,
      reply: { text: `💸 Usage cost\n${sessionLine}\n${todayLine}\n${last30Line}` },
    };
  }

  if (rawArgs && !requested) {
    return {
      shouldContinue: false,
      reply: { text: "⚙️ Usage: /usage off|tokens|full|cost" },
    };
  }

  const currentRaw =
    params.sessionEntry?.responseUsage ??
    (params.sessionKey ? params.sessionStore?.[params.sessionKey]?.responseUsage : undefined);
  const current = resolveResponseUsageMode(currentRaw);
  const next = requested ?? (current === "off" ? "tokens" : current === "tokens" ? "full" : "off");

  await applySessionEntryMutation({
    entry: params.sessionEntry,
    sessionStore: params.sessionStore,
    sessionKey: params.sessionKey,
    storePath: params.storePath,
    mutate: (entry) => {
      if (next === "off") {
        delete entry.responseUsage;
      } else {
        entry.responseUsage = next;
      }
    },
  });

  return {
    shouldContinue: false,
    reply: {
      text: `⚙️ Usage footer: ${next}.`,
    },
  };
};

export const handleRestartCommand: CommandHandler = async (params, allowTextCommands) => {
  if (!allowTextCommands) {
    return null;
  }
  if (params.command.commandBodyNormalized !== "/restart") {
    return null;
  }
  if (!params.command.isAuthorizedSender) {
    logVerbose(
      `Ignoring /restart from unauthorized sender: ${params.command.senderId || "<unknown>"}`,
    );
    return { shouldContinue: false };
  }
  if (params.cfg.commands?.restart !== true) {
    return {
      shouldContinue: false,
      reply: {
        text: "⚠️ /restart is disabled. Set commands.restart=true to enable.",
      },
    };
  }
  const hasSigusr1Listener = process.listenerCount("SIGUSR1") > 0;
  if (hasSigusr1Listener) {
    scheduleGatewaySigusr1Restart({ reason: "/restart" });
    return {
      shouldContinue: false,
      reply: {
        text: "⚙️ Restarting OpenClaw in-process (SIGUSR1); back in a few seconds.",
      },
    };
  }
  const restartMethod = triggerOpenClawRestart();
  if (!restartMethod.ok) {
    const detail = restartMethod.detail ? ` Details: ${restartMethod.detail}` : "";
    return {
      shouldContinue: false,
      reply: {
        text: `⚠️ Restart failed (${restartMethod.method}).${detail}`,
      },
    };
  }
  return {
    shouldContinue: false,
    reply: {
      text: `⚙️ Restarting OpenClaw via ${restartMethod.method}; give me a few seconds to come back online.`,
    },
  };
};

export const handleStopCommand: CommandHandler = async (params, allowTextCommands) => {
  if (!allowTextCommands) {
    return null;
  }
  if (params.command.commandBodyNormalized !== "/stop") {
    return null;
  }
  if (!params.command.isAuthorizedSender) {
    logVerbose(
      `Ignoring /stop from unauthorized sender: ${params.command.senderId || "<unknown>"}`,
    );
    return { shouldContinue: false };
  }
  const abortTarget = resolveAbortTarget({
    ctx: params.ctx,
    sessionKey: params.sessionKey,
    sessionEntry: params.sessionEntry,
    sessionStore: params.sessionStore,
  });
  if (abortTarget.sessionId) {
    abortEmbeddedPiRun(abortTarget.sessionId);
  }
  const cleared = clearSessionQueues([abortTarget.key, abortTarget.sessionId]);
  if (cleared.followupCleared > 0 || cleared.laneCleared > 0) {
    logVerbose(
      `stop: cleared followups=${cleared.followupCleared} lane=${cleared.laneCleared} keys=${cleared.keys.join(",")}`,
    );
  }
  if (abortTarget.entry && params.sessionStore && abortTarget.key) {
    await applySessionEntryMutation({
      entry: abortTarget.entry,
      sessionStore: params.sessionStore,
      sessionKey: abortTarget.key,
      storePath: params.storePath,
      mutate: (entry) => {
        entry.abortedLastRun = true;
      },
    });
  } else if (params.command.abortKey) {
    setAbortMemory(params.command.abortKey, true);
  }

  // Trigger internal hook for stop command
  const hookEvent = createInternalHookEvent(
    "command",
    "stop",
    abortTarget.key ?? params.sessionKey ?? "",
    {
      sessionEntry: abortTarget.entry ?? params.sessionEntry,
      sessionId: abortTarget.sessionId,
      commandSource: params.command.surface,
      senderId: params.command.senderId,
    },
  );
  await triggerInternalHook(hookEvent);

  const { stopped } = stopSubagentsForRequester({
    cfg: params.cfg,
    requesterSessionKey: abortTarget.key ?? params.sessionKey,
  });

  return { shouldContinue: false, reply: { text: formatAbortReplyText(stopped) } };
};

export const handleAbortTrigger: CommandHandler = async (params, allowTextCommands) => {
  if (!allowTextCommands) {
    return null;
  }
  if (!isAbortTrigger(params.command.rawBodyNormalized)) {
    return null;
  }
  const abortTarget = resolveAbortTarget({
    ctx: params.ctx,
    sessionKey: params.sessionKey,
    sessionEntry: params.sessionEntry,
    sessionStore: params.sessionStore,
  });
  if (abortTarget.sessionId) {
    abortEmbeddedPiRun(abortTarget.sessionId);
  }
  if (abortTarget.entry && params.sessionStore && abortTarget.key) {
    await applySessionEntryMutation({
      entry: abortTarget.entry,
      sessionStore: params.sessionStore,
      sessionKey: abortTarget.key,
      storePath: params.storePath,
      mutate: (entry) => {
        entry.abortedLastRun = true;
      },
    });
  } else if (params.command.abortKey) {
    setAbortMemory(params.command.abortKey, true);
  }
  return { shouldContinue: false, reply: { text: "⚙️ Agent was aborted." } };
};
