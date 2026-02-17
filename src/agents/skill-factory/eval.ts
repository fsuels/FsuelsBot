import fs from "node:fs/promises";
import path from "node:path";
import type { OpenClawConfig } from "../../config/config.js";
import type {
  SkillFactoryEpisode,
  SkillFactoryEvalRecord,
  SkillFactoryRuntimeProfile,
  SkillFactorySkillVersion,
} from "./types.js";
import { medianDurationMs } from "./episodes.js";
import { sha256 } from "./signature.js";

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) {
    return String(value);
  }
  if (typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).toSorted();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

export function computeToolPolicyHash(config?: OpenClawConfig): string {
  const relevant = {
    tools: config?.tools,
    agents: config?.agents?.list?.map((entry) => ({
      id: entry.id,
      tools: entry.tools,
      skills: entry.skills,
    })),
    skills: config?.skills,
  };
  return sha256(stableStringify(relevant));
}

export function buildRuntimeProfile(params: {
  provider?: string;
  model?: string;
  config?: OpenClawConfig;
  surface: SkillFactoryRuntimeProfile["surface"];
}): SkillFactoryRuntimeProfile {
  return {
    provider: params.provider,
    model: params.model,
    toolPolicyHash: computeToolPolicyHash(params.config),
    surface: params.surface,
  };
}

function computeDatasetHash(episodes: SkillFactoryEpisode[]): string {
  const compact = episodes
    .map((episode) => `${episode.id}:${episode.outcome}:${episode.durationMs}`)
    .toSorted()
    .join("|");
  return sha256(compact);
}

async function loadEvalRecords(pathname: string): Promise<SkillFactoryEvalRecord[]> {
  let raw = "";
  try {
    raw = await fs.readFile(pathname, "utf-8");
  } catch {
    return [];
  }
  const out: SkillFactoryEvalRecord[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    try {
      const parsed = JSON.parse(line) as SkillFactoryEvalRecord;
      if (!parsed || typeof parsed.key !== "string") {
        continue;
      }
      out.push(parsed);
    } catch {
      // ignore malformed line
    }
  }
  return out;
}

async function appendEvalRecord(pathname: string, record: SkillFactoryEvalRecord): Promise<void> {
  await fs.mkdir(path.dirname(pathname), { recursive: true });
  await fs.appendFile(pathname, `${JSON.stringify(record)}\n`, "utf-8");
}

function successRate(episodes: SkillFactoryEpisode[]): number {
  if (episodes.length === 0) {
    return 0;
  }
  const successCount = episodes.filter((episode) => episode.outcome === "success").length;
  return successCount / episodes.length;
}

function candidateSubset(episodes: SkillFactoryEpisode[], toolName: string): SkillFactoryEpisode[] {
  const normalized = toolName.trim().toLowerCase();
  return episodes.filter((episode) =>
    episode.toolNames.some((tool) => tool.trim().toLowerCase() === normalized),
  );
}

export async function evaluateSkillDraft(params: {
  evalPath: string;
  skillKey: string;
  suiteId: string;
  version: SkillFactorySkillVersion;
  episodes: SkillFactoryEpisode[];
  runtime: SkillFactoryRuntimeProfile;
}): Promise<{ record: SkillFactoryEvalRecord; cached: boolean }> {
  const datasetHash = computeDatasetHash(params.episodes);
  const runtimeHash = sha256(stableStringify(params.runtime));
  const evalKey = sha256(`${params.version.hash}|${datasetHash}|${params.suiteId}|${runtimeHash}`);

  const existing = (await loadEvalRecords(params.evalPath)).find(
    (record) => record.key === evalKey,
  );
  if (existing && existing.passed) {
    return { record: existing, cached: true };
  }

  const baseline = params.episodes;
  // We cannot execute the draft directly yet, so use deterministic coverage proxy.
  const dominantTool = params.version.dispatchTool;
  const candidateEpisodes = candidateSubset(baseline, dominantTool);

  const baselineSuccessRate = successRate(baseline);
  const candidateSuccessRate =
    candidateEpisodes.length > 0 ? successRate(candidateEpisodes) : baselineSuccessRate;
  const baselineMedianDurationMs = medianDurationMs(baseline);
  const candidateMedianDurationMs =
    candidateEpisodes.length > 0 ? medianDurationMs(candidateEpisodes) : baselineMedianDurationMs;

  const samples = baseline.length;
  const passBySamples = samples >= 3;
  const passByReliability = candidateSuccessRate >= baselineSuccessRate;
  const passBySpeed =
    baselineMedianDurationMs <= 0 ||
    candidateMedianDurationMs <= Math.round(baselineMedianDurationMs * 1.1);

  const passed = passBySamples && passByReliability && passBySpeed;
  const reason = passed
    ? "passed"
    : !passBySamples
      ? "insufficient samples"
      : !passByReliability
        ? "reliability regression"
        : "speed regression";

  const record: SkillFactoryEvalRecord = {
    key: evalKey,
    ts: Date.now(),
    skillKey: params.skillKey,
    skillHash: params.version.hash,
    suiteId: params.suiteId,
    datasetHash,
    runtimeHash,
    passed,
    metrics: {
      samples,
      baselineSuccessRate,
      candidateSuccessRate,
      baselineMedianDurationMs,
      candidateMedianDurationMs,
    },
    reason,
  };

  await appendEvalRecord(params.evalPath, record);
  return { record, cached: false };
}
