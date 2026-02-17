import type { RuntimeEnv } from "../runtime.js";
import { resolveDefaultAgentId } from "../agents/agent-scope.js";
import { resolveAgentWorkspaceDir } from "../agents/agent-scope.js";
import { backfillSkillFactoryEpisodes } from "../agents/skill-factory/backfill.js";
import { loadEpisodes } from "../agents/skill-factory/episodes.js";
import { buildRuntimeProfile, evaluateSkillDraft } from "../agents/skill-factory/eval.js";
import {
  resolveSkillFactoryEpisodesPath,
  resolveSkillFactoryEvalPath,
  resolveSkillFactoryRegistryPath,
  resolveSkillFactoryRepeatIndexPath,
} from "../agents/skill-factory/paths.js";
import {
  loadSkillFactoryRegistry,
  markSkillFactoryVersionStatus,
  promoteSkillFactoryVersion,
} from "../agents/skill-factory/registry.js";
import { loadRepeatIndex } from "../agents/skill-factory/repeats.js";
import { loadConfig } from "../config/config.js";

type SkillFactoryBaseOpts = {
  agent?: string;
};

export async function skillFactoryBackfillCommand(
  opts: SkillFactoryBaseOpts & { full?: boolean },
  runtime: RuntimeEnv,
) {
  const cfg = loadConfig();
  const agentId = opts.agent?.trim() || resolveDefaultAgentId(cfg);
  const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);
  const result = await backfillSkillFactoryEpisodes({
    agentId,
    workspaceDir,
    full: Boolean(opts.full),
  });
  runtime.log(
    `Skill factory backfill: processed=${result.processedFiles} skippedFiles=${result.skippedFiles} ` +
      `createdEpisodes=${result.createdEpisodes} skippedEpisodes=${result.skippedEpisodes}`,
  );
}

export async function skillFactoryStatusCommand(opts: SkillFactoryBaseOpts, runtime: RuntimeEnv) {
  const cfg = loadConfig();
  const agentId = opts.agent?.trim() || resolveDefaultAgentId(cfg);
  const episodesPath = resolveSkillFactoryEpisodesPath(agentId);
  const repeatPath = resolveSkillFactoryRepeatIndexPath(agentId);
  const registryPath = resolveSkillFactoryRegistryPath(agentId);

  const episodes = await loadEpisodes({ pathname: episodesPath });
  const repeatIndex = await loadRepeatIndex(repeatPath);
  const registry = await loadSkillFactoryRegistry(registryPath);

  const trustedCount = Object.values(registry.skills).filter((skill) =>
    Boolean(skill.trustedHash),
  ).length;
  const candidateCount = Object.values(registry.skills)
    .flatMap((skill) => Object.values(skill.versions))
    .filter((version) => version.status === "candidate").length;
  const draftCount = Object.values(registry.skills)
    .flatMap((skill) => Object.values(skill.versions))
    .filter((version) => version.status === "draft").length;

  runtime.log(`Skill factory status (agent=${agentId})`);
  runtime.log(`- Episodes: ${episodes.length}`);
  runtime.log(`- Repeat signatures: ${Object.keys(repeatIndex.entries).length}`);
  runtime.log(`- Skills: ${Object.keys(registry.skills).length}`);
  runtime.log(`- Trusted versions: ${trustedCount}`);
  runtime.log(`- Candidate versions: ${candidateCount}`);
  runtime.log(`- Draft versions: ${draftCount}`);
}

export async function skillFactoryEvaluateCommand(
  opts: SkillFactoryBaseOpts & {
    skill: string;
    hash?: string;
    promoteIfPass?: boolean;
  },
  runtime: RuntimeEnv,
) {
  const cfg = loadConfig();
  const agentId = opts.agent?.trim() || resolveDefaultAgentId(cfg);
  const registryPath = resolveSkillFactoryRegistryPath(agentId);
  const evalPath = resolveSkillFactoryEvalPath(agentId);
  const episodesPath = resolveSkillFactoryEpisodesPath(agentId);
  const registry = await loadSkillFactoryRegistry(registryPath);
  const skill = registry.skills[opts.skill];
  if (!skill) {
    throw new Error(`Unknown skill key: ${opts.skill}`);
  }

  const version =
    (opts.hash ? skill.versions[opts.hash] : undefined) ??
    Object.values(skill.versions)
      .toSorted((a, b) => b.createdAt - a.createdAt)
      .find((candidate) => candidate.status !== "trusted");

  if (!version) {
    throw new Error(`No candidate/draft version found for skill: ${opts.skill}`);
  }

  const episodes = await loadEpisodes({
    pathname: episodesPath,
    signature: version.sourceSignature,
    max: 200,
  });
  const evaluation = await evaluateSkillDraft({
    evalPath,
    skillKey: skill.skillKey,
    suiteId: "episodes-v1",
    version,
    episodes,
    runtime: buildRuntimeProfile({
      provider: undefined,
      model: undefined,
      config: cfg,
      surface: "embedded",
    }),
  });

  await markSkillFactoryVersionStatus({
    pathname: registryPath,
    skillKey: skill.skillKey,
    hash: version.hash,
    status: evaluation.record.passed ? "candidate" : "rejected",
    lastEvalKey: evaluation.record.key,
  });

  runtime.log(
    `Skill eval ${skill.skillKey}@${version.hash.slice(0, 8)} passed=${evaluation.record.passed} ` +
      `cached=${evaluation.cached} reason=${evaluation.record.reason ?? "n/a"}`,
  );

  if (evaluation.record.passed && opts.promoteIfPass) {
    const promoted = await promoteSkillFactoryVersion({
      pathname: registryPath,
      skillKey: skill.skillKey,
      hash: version.hash,
    });
    runtime.log(
      promoted.ok
        ? `Promoted ${skill.skillKey}@${version.hash.slice(0, 8)} to trusted`
        : `Promotion failed: ${promoted.message}`,
    );
  }
}

export async function skillFactoryPromoteCommand(
  opts: SkillFactoryBaseOpts & {
    skill: string;
    hash: string;
  },
  runtime: RuntimeEnv,
) {
  const cfg = loadConfig();
  const agentId = opts.agent?.trim() || resolveDefaultAgentId(cfg);
  const registryPath = resolveSkillFactoryRegistryPath(agentId);
  const promoted = await promoteSkillFactoryVersion({
    pathname: registryPath,
    skillKey: opts.skill,
    hash: opts.hash,
  });
  if (!promoted.ok) {
    throw new Error(promoted.message);
  }
  runtime.log(`Promoted ${opts.skill}@${opts.hash.slice(0, 8)} to trusted`);
}
