import type { OpenClawConfig } from "../../config/config.js";
import type { SkillFactoryEpisode, SkillFactoryOutcome } from "./types.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { parseBooleanValue } from "../../utils/boolean.js";
import { createSkillDraftFromEpisodes } from "./drafts.js";
import { appendEpisode, loadEpisodes, safeLogEpisodeError } from "./episodes.js";
import { buildRuntimeProfile, evaluateSkillDraft } from "./eval.js";
import {
  resolveSkillFactoryEpisodesPath,
  resolveSkillFactoryEvalPath,
  resolveSkillFactoryRegistryPath,
  resolveSkillFactoryRepeatIndexPath,
} from "./paths.js";
import {
  loadSkillFactoryRegistry,
  markSkillFactoryVersionStatus,
  promoteSkillFactoryVersion,
  upsertSkillFactoryVersion,
} from "./registry.js";
import { recordEpisodeInRepeatIndex } from "./repeats.js";
import { hashNullable, hashWorkspaceLabel, sha256, computeIntentSignature } from "./signature.js";

const log = createSubsystemLogger("skill-factory");

function readBool(name: string, fallback: boolean): boolean {
  return parseBooleanValue(process.env[name]) ?? fallback;
}

function readInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw || !raw.trim()) {
    return fallback;
  }
  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function resolveFactoryFlags() {
  const minRepeats = readInt("OPENCLAW_SKILL_FACTORY_MIN_REPEATS", 3);
  const windowDays = readInt("OPENCLAW_SKILL_FACTORY_REPEAT_WINDOW_DAYS", 7);
  return {
    enabled: readBool("OPENCLAW_SKILL_FACTORY_ENABLED", true),
    autoBuild: readBool("OPENCLAW_SKILL_FACTORY_AUTOBUILD", true),
    autoPromote: readBool("OPENCLAW_SKILL_FACTORY_AUTO_PROMOTE", false),
    minRepeats,
    windowMs: windowDays * 24 * 60 * 60 * 1000,
  };
}

function shouldSkipEpisode(params: {
  prompt: string;
  sessionKey?: string;
  sessionId?: string;
}): boolean {
  if (!params.prompt.trim()) {
    return true;
  }
  const sessionKey = (params.sessionKey ?? "").trim().toLowerCase();
  if (sessionKey.startsWith("temp:") || sessionKey.includes("slug-generator")) {
    return true;
  }
  const sessionId = (params.sessionId ?? "").trim().toLowerCase();
  if (sessionId.startsWith("probe-") || sessionId.includes("slug-generator")) {
    return true;
  }
  return false;
}

export function buildSkillFactoryEpisode(params: {
  agentId: string;
  workspaceDir?: string;
  sessionKey?: string;
  sessionId?: string;
  taskId?: string;
  runId?: string;
  source: SkillFactoryEpisode["source"];
  prompt: string;
  taskTitle?: string;
  toolNames: string[];
  startedAt: number;
  endedAt: number;
  provider?: string;
  model?: string;
  usage?: { input?: number; output?: number; total?: number };
  outcome: SkillFactoryOutcome;
  errorKind?: string;
  errorMessage?: string;
  generatedSkillKey?: string;
}): SkillFactoryEpisode {
  const signature = computeIntentSignature({
    prompt: params.prompt,
    toolNames: params.toolNames,
    taskTitle: params.taskTitle,
  });
  const { workspaceHash, workspaceLabel } = hashWorkspaceLabel(params.workspaceDir);
  const idBase = [
    params.agentId,
    workspaceHash,
    params.source,
    signature.signature,
    hashNullable(params.runId) ?? hashNullable(params.sessionId) ?? String(params.startedAt),
    String(params.startedAt),
    String(params.endedAt),
  ].join("|");

  return {
    id: sha256(idBase),
    ts: params.endedAt,
    startedAt: params.startedAt,
    endedAt: params.endedAt,
    durationMs: Math.max(0, params.endedAt - params.startedAt),
    agentId: params.agentId,
    workspaceHash,
    workspaceLabel,
    sessionKeyHash: hashNullable(params.sessionKey),
    sessionIdHash: hashNullable(params.sessionId),
    taskIdHash: hashNullable(params.taskId),
    runIdHash: hashNullable(params.runId),
    source: params.source,
    intentSummary: signature.summary,
    intentHash: signature.intentHash,
    intentSignature: signature.signature,
    toolNames: params.toolNames,
    toolCount: params.toolNames.length,
    provider: params.provider,
    model: params.model,
    usage: params.usage,
    outcome: params.outcome,
    errorKind: params.errorKind,
    errorMessage: params.errorMessage,
    generatedSkillKey: params.generatedSkillKey,
  };
}

export async function processSkillFactoryEpisode(params: {
  agentId: string;
  workspaceDir?: string;
  config?: OpenClawConfig;
  sessionKey?: string;
  sessionId?: string;
  taskId?: string;
  runId?: string;
  source: SkillFactoryEpisode["source"];
  prompt: string;
  taskTitle?: string;
  toolNames: string[];
  startedAt: number;
  endedAt: number;
  provider?: string;
  model?: string;
  usage?: { input?: number; output?: number; total?: number };
  outcome: SkillFactoryOutcome;
  errorKind?: string;
  errorMessage?: string;
  generatedSkillKey?: string;
}): Promise<void> {
  const flags = resolveFactoryFlags();
  if (!flags.enabled) {
    return;
  }
  if (
    shouldSkipEpisode({
      prompt: params.prompt,
      sessionKey: params.sessionKey,
      sessionId: params.sessionId,
    })
  ) {
    return;
  }

  const episode = buildSkillFactoryEpisode(params);
  const episodesPath = resolveSkillFactoryEpisodesPath(params.agentId);
  const repeatPath = resolveSkillFactoryRepeatIndexPath(params.agentId);
  const registryPath = resolveSkillFactoryRegistryPath(params.agentId);
  const evalPath = resolveSkillFactoryEvalPath(params.agentId);

  await appendEpisode(episodesPath, episode);

  const repeatResult = await recordEpisodeInRepeatIndex({
    pathname: repeatPath,
    episode,
    thresholds: {
      minCount: flags.minRepeats,
      windowMs: flags.windowMs,
    },
  });

  if (!flags.autoBuild || !repeatResult.crossedThreshold) {
    return;
  }

  const registry = await loadSkillFactoryRegistry(registryPath);
  const existingTrusted = Object.values(registry.skills).find(
    (skill) => skill.versions[skill.trustedHash ?? ""]?.sourceSignature === episode.intentSignature,
  );
  if (existingTrusted) {
    return;
  }

  const matchingEpisodes = await loadEpisodes({
    pathname: episodesPath,
    signature: episode.intentSignature,
    max: 200,
  });
  const draft = await createSkillDraftFromEpisodes({
    agentId: params.agentId,
    signature: episode.intentSignature,
    episodes: matchingEpisodes,
  });
  if (!draft) {
    return;
  }

  await upsertSkillFactoryVersion({
    pathname: registryPath,
    skillKey: draft.skillKey,
    skillName: draft.skillName,
    version: draft.version,
  });

  const evaluation = await evaluateSkillDraft({
    evalPath,
    skillKey: draft.skillKey,
    suiteId: "episodes-v1",
    version: draft.version,
    episodes: matchingEpisodes,
    runtime: buildRuntimeProfile({
      provider: params.provider,
      model: params.model,
      config: params.config,
      surface: params.source === "cli" ? "cli" : "embedded",
    }),
  });

  await markSkillFactoryVersionStatus({
    pathname: registryPath,
    skillKey: draft.skillKey,
    hash: draft.version.hash,
    status: evaluation.record.passed ? "candidate" : "rejected",
    lastEvalKey: evaluation.record.key,
  });

  if (evaluation.record.passed && flags.autoPromote) {
    const promoted = await promoteSkillFactoryVersion({
      pathname: registryPath,
      skillKey: draft.skillKey,
      hash: draft.version.hash,
    });
    if (!promoted.ok) {
      log.warn(`skill-factory auto-promote failed: ${promoted.message}`);
    }
  }

  log.info(
    `skill-factory drafted ${draft.skillKey}@${draft.version.hash.slice(0, 8)} ` +
      `(passed=${evaluation.record.passed} cached=${evaluation.cached})`,
  );
}

export function processSkillFactoryEpisodeDetached(
  params: Parameters<typeof processSkillFactoryEpisode>[0],
): void {
  void processSkillFactoryEpisode(params).catch((error) => {
    safeLogEpisodeError("skill-factory episode processing failed", error);
  });
}
