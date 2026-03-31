import crypto from "node:crypto";
import type { OpenClawConfig } from "../config/config.js";
import { formatThinkingLevels, normalizeThinkLevel } from "../auto-reply/thinking.js";
import { loadSessionStore, resolveStorePath, type SessionEntry } from "../config/sessions.js";
import { callGateway } from "../gateway/call.js";
import { normalizeAgentId } from "../routing/session-key.js";
import { SESSION_LABEL_MAX_LENGTH } from "../sessions/session-label.js";
import { resolveAgentConfig, resolveDefaultAgentId } from "./agent-scope.js";
import { resolveDefaultModelForAgent, resolveThinkingDefault } from "./model-selection.js";

export type SubagentModelSource =
  | "explicit"
  | "target-agent-subagents"
  | "global-subagents"
  | "parent-session";

export type SubagentThinkingSource =
  | "explicit"
  | "target-agent-subagents"
  | "global-subagents"
  | "parent-session";

export type ResolvedSubagentLaunchConfig = {
  childSessionKey: string;
  childIdempotencyKey: string;
  resolvedModel?: string;
  resolvedModelSource?: SubagentModelSource;
  resolvedThinking?: string;
  resolvedThinkingSource?: SubagentThinkingSource;
};

export type ReservedSubagentSessionSettings = {
  appliedLabel?: string;
  modelApplied?: boolean;
  modelWarning?: string;
};

function readTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeModelSelection(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const primary = (value as { primary?: unknown }).primary;
  if (typeof primary === "string" && primary.trim()) {
    return primary.trim();
  }
  return undefined;
}

function normalizeInheritValue(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  return value.trim().toLowerCase() === "inherit" ? "inherit" : value;
}

function formatModelRef(params: { provider: string; model: string }): string {
  return `${params.provider}/${params.model}`;
}

function resolveRequesterSessionEntry(params: {
  cfg: OpenClawConfig;
  requesterSessionKey: string;
  requesterAgentId: string;
}): SessionEntry | undefined {
  const storePath = resolveStorePath(params.cfg.session?.store, {
    agentId: params.requesterAgentId,
  });
  return loadSessionStore(storePath)[params.requesterSessionKey];
}

function resolveRequesterEffectiveModel(params: {
  cfg: OpenClawConfig;
  requesterSessionKey: string;
  requesterAgentId: string;
}) {
  const entry = resolveRequesterSessionEntry(params);
  const fallback = resolveDefaultModelForAgent({
    cfg: params.cfg,
    agentId: params.requesterAgentId,
  });
  const model = entry?.modelOverride?.trim();
  if (model) {
    return {
      provider: entry?.providerOverride?.trim() || fallback.provider,
      model,
    };
  }
  return fallback;
}

function resolveRequesterEffectiveThinking(params: {
  cfg: OpenClawConfig;
  requesterSessionKey: string;
  requesterAgentId: string;
  requesterModel: { provider: string; model: string };
}) {
  const entry = resolveRequesterSessionEntry(params);
  const stored = readTrimmedString(entry?.thinkingLevel);
  if (stored) {
    return stored;
  }
  return resolveThinkingDefault({
    cfg: params.cfg,
    provider: params.requesterModel.provider,
    model: params.requesterModel.model,
  });
}

function buildDeterministicSpawnDigest(params: {
  requesterSessionKey: string;
  targetAgentId: string;
  task: string;
  label?: string;
  toolCallId: string;
}) {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        requesterSessionKey: params.requesterSessionKey,
        targetAgentId: params.targetAgentId,
        task: params.task,
        label: params.label ?? "",
        toolCallId: params.toolCallId,
      }),
    )
    .digest("hex");
}

function buildLabelWithSuffix(label: string, suffix: number) {
  const suffixText = ` ${suffix}`;
  const baseMaxLength = Math.max(1, SESSION_LABEL_MAX_LENGTH - suffixText.length);
  const base = label.slice(0, baseMaxLength).trimEnd();
  return `${base}${suffixText}`;
}

function isRecoverableModelError(message: string) {
  const lowered = message.toLowerCase();
  return lowered.includes("invalid model") || lowered.includes("model not allowed");
}

function isDuplicateLabelError(message: string) {
  return message.toLowerCase().includes("label already in use:");
}

export function resolveSubagentLaunchConfig(params: {
  cfg: OpenClawConfig;
  requesterSessionKey: string;
  requesterAgentId: string;
  targetAgentId?: string;
  task: string;
  label?: string;
  toolCallId: string;
  requestedModel?: string;
  requestedThinking?: string;
}): { ok: true; value: ResolvedSubagentLaunchConfig } | { ok: false; error: string } {
  const requesterAgentId = normalizeAgentId(
    params.requesterAgentId || resolveDefaultAgentId(params.cfg),
  );
  const targetAgentId = normalizeAgentId(params.targetAgentId || requesterAgentId);
  const digest = buildDeterministicSpawnDigest({
    requesterSessionKey: params.requesterSessionKey,
    targetAgentId,
    task: params.task.trim(),
    label: params.label,
    toolCallId: params.toolCallId.trim() || crypto.randomUUID(),
  });
  const requesterModel = resolveRequesterEffectiveModel({
    cfg: params.cfg,
    requesterSessionKey: params.requesterSessionKey,
    requesterAgentId,
  });
  const requesterModelRef = formatModelRef(requesterModel);
  const requesterThinking = resolveRequesterEffectiveThinking({
    cfg: params.cfg,
    requesterSessionKey: params.requesterSessionKey,
    requesterAgentId,
    requesterModel,
  });
  const targetAgentConfig = resolveAgentConfig(params.cfg, targetAgentId);
  const requestedModel = normalizeInheritValue(readTrimmedString(params.requestedModel));
  const configuredTargetModel = normalizeInheritValue(
    normalizeModelSelection(targetAgentConfig?.subagents?.model),
  );
  const configuredDefaultModel = normalizeInheritValue(
    normalizeModelSelection(params.cfg.agents?.defaults?.subagents?.model),
  );

  let resolvedModel: string | undefined;
  let resolvedModelSource: SubagentModelSource | undefined;
  const modelCandidates: Array<{
    value: string | undefined;
    source: Exclude<SubagentModelSource, "parent-session">;
  }> = [
    { value: requestedModel, source: "explicit" },
    { value: configuredTargetModel, source: "target-agent-subagents" },
    { value: configuredDefaultModel, source: "global-subagents" },
  ];
  for (const candidate of modelCandidates) {
    if (!candidate.value) {
      continue;
    }
    if (candidate.value === "inherit") {
      resolvedModel = requesterModelRef;
      resolvedModelSource = "parent-session";
      break;
    }
    resolvedModel = candidate.value;
    resolvedModelSource = candidate.source;
    break;
  }
  if (!resolvedModel) {
    resolvedModel = requesterModelRef;
    resolvedModelSource = "parent-session";
  }

  const requestedThinking = normalizeInheritValue(readTrimmedString(params.requestedThinking));
  const configuredTargetThinking = normalizeInheritValue(
    readTrimmedString(
      (targetAgentConfig?.subagents as { thinking?: unknown } | undefined)?.thinking,
    ),
  );
  const configuredDefaultThinking = normalizeInheritValue(
    readTrimmedString(params.cfg.agents?.defaults?.subagents?.thinking),
  );

  let resolvedThinking: string | undefined;
  let resolvedThinkingSource: SubagentThinkingSource | undefined;
  const thinkingCandidates: Array<{
    value: string | undefined;
    source: Exclude<SubagentThinkingSource, "parent-session">;
  }> = [
    { value: requestedThinking, source: "explicit" },
    { value: configuredTargetThinking, source: "target-agent-subagents" },
    { value: configuredDefaultThinking, source: "global-subagents" },
  ];
  for (const candidate of thinkingCandidates) {
    if (!candidate.value) {
      continue;
    }
    if (candidate.value === "inherit") {
      resolvedThinking = requesterThinking;
      resolvedThinkingSource = "parent-session";
      break;
    }
    const normalized = normalizeThinkLevel(candidate.value);
    if (!normalized) {
      const provider = requesterModel.provider;
      const model = requesterModel.model;
      return {
        ok: false,
        error: `Invalid thinking level "${candidate.value}". Use one of: ${formatThinkingLevels(provider, model)}.`,
      };
    }
    resolvedThinking = normalized;
    resolvedThinkingSource = candidate.source;
    break;
  }

  return {
    ok: true,
    value: {
      childSessionKey: `agent:${targetAgentId}:subagent:${digest.slice(0, 24)}`,
      childIdempotencyKey: `subagent-${digest}`,
      resolvedModel,
      resolvedModelSource,
      resolvedThinking,
      resolvedThinkingSource,
    },
  };
}

export async function reserveSubagentSessionSettings(params: {
  childSessionKey: string;
  label?: string;
  resolvedModel?: string;
  resolvedThinking?: string;
}): Promise<ReservedSubagentSessionSettings> {
  const baseLabel = readTrimmedString(params.label);
  let labelCandidate = baseLabel;
  let labelSuffix = 2;
  const wantsModel = Boolean(readTrimmedString(params.resolvedModel));
  let modelCandidate = readTrimmedString(params.resolvedModel);
  let modelWarning: string | undefined;

  if (!labelCandidate && !modelCandidate && params.resolvedThinking === undefined) {
    return {};
  }

  for (let attempt = 0; attempt < 64; attempt += 1) {
    const patch: Record<string, unknown> = {
      key: params.childSessionKey,
    };
    if (modelCandidate) {
      patch.model = modelCandidate;
    }
    if (params.resolvedThinking !== undefined) {
      patch.thinkingLevel = params.resolvedThinking === "off" ? null : params.resolvedThinking;
    }
    if (labelCandidate) {
      patch.label = labelCandidate;
    }
    try {
      await callGateway({
        method: "sessions.patch",
        params: patch,
        timeoutMs: 10_000,
      });
      return {
        appliedLabel: labelCandidate,
        modelApplied: wantsModel ? Boolean(modelCandidate) : undefined,
        modelWarning,
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : typeof err === "string" ? err : String(err);
      if (modelCandidate && isRecoverableModelError(message)) {
        modelWarning = message;
        modelCandidate = undefined;
        if (!labelCandidate && params.resolvedThinking === undefined) {
          return {
            appliedLabel: undefined,
            modelApplied: wantsModel ? false : undefined,
            modelWarning,
          };
        }
        continue;
      }
      if (labelCandidate && baseLabel && isDuplicateLabelError(message)) {
        labelCandidate = buildLabelWithSuffix(baseLabel, labelSuffix);
        labelSuffix += 1;
        continue;
      }
      throw err;
    }
  }

  throw new Error(`Unable to reserve subagent session settings for ${params.childSessionKey}`);
}
