import fs from "node:fs/promises";
import path from "node:path";
import type {
  SkillFactoryEpisode,
  SkillFactoryRepeatEntry,
  SkillFactoryRepeatIndex,
} from "./types.js";

export type RepeatThresholds = {
  minCount: number;
  windowMs: number;
};

const DEFAULT_REPEAT_THRESHOLDS: RepeatThresholds = {
  minCount: 3,
  windowMs: 7 * 24 * 60 * 60 * 1000,
};

function createEmptyIndex(): SkillFactoryRepeatIndex {
  return {
    version: 1,
    updatedAt: Date.now(),
    entries: {},
  };
}

export async function loadRepeatIndex(pathname: string): Promise<SkillFactoryRepeatIndex> {
  try {
    const raw = await fs.readFile(pathname, "utf-8");
    const parsed = JSON.parse(raw) as SkillFactoryRepeatIndex;
    if (!parsed || parsed.version !== 1 || typeof parsed.entries !== "object") {
      return createEmptyIndex();
    }
    return parsed;
  } catch {
    return createEmptyIndex();
  }
}

export async function saveRepeatIndex(
  pathname: string,
  index: SkillFactoryRepeatIndex,
): Promise<void> {
  await fs.mkdir(path.dirname(pathname), { recursive: true });
  const tmp = `${pathname}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, `${JSON.stringify(index, null, 2)}\n`, "utf-8");
  await fs.rename(tmp, pathname);
}

function pruneEntryByWindow(entry: SkillFactoryRepeatEntry, now: number, windowMs: number) {
  // Keep approximate recency by episode id list length, but preserve count floor for historical signal.
  if (entry.lastSeenAt < now - windowMs) {
    entry.count = Math.min(entry.count, 1);
    entry.episodeIds = entry.episodeIds.slice(-1);
  }
}

export async function recordEpisodeInRepeatIndex(params: {
  pathname: string;
  episode: SkillFactoryEpisode;
  thresholds?: Partial<RepeatThresholds>;
}): Promise<{
  index: SkillFactoryRepeatIndex;
  entry: SkillFactoryRepeatEntry;
  crossedThreshold: boolean;
}> {
  const thresholds: RepeatThresholds = {
    minCount: params.thresholds?.minCount ?? DEFAULT_REPEAT_THRESHOLDS.minCount,
    windowMs: params.thresholds?.windowMs ?? DEFAULT_REPEAT_THRESHOLDS.windowMs,
  };
  const now = params.episode.endedAt || Date.now();
  const index = await loadRepeatIndex(params.pathname);
  const scopedSignature = `${params.episode.agentId}:${params.episode.workspaceHash}:${params.episode.intentSignature}`;
  const existing = index.entries[scopedSignature];
  const before = existing?.count ?? 0;
  const entry: SkillFactoryRepeatEntry = existing
    ? { ...existing }
    : {
        scopedSignature,
        signature: params.episode.intentSignature,
        count: 0,
        firstSeenAt: now,
        lastSeenAt: now,
        episodeIds: [],
        intentSummary: params.episode.intentSummary,
        toolNames: params.episode.toolNames.slice(0, 8),
      };

  pruneEntryByWindow(entry, now, thresholds.windowMs);

  entry.count += 1;
  entry.lastSeenAt = now;
  entry.intentSummary = params.episode.intentSummary || entry.intentSummary;
  if (entry.episodeIds[entry.episodeIds.length - 1] !== params.episode.id) {
    entry.episodeIds.push(params.episode.id);
  }
  if (entry.episodeIds.length > 20) {
    entry.episodeIds = entry.episodeIds.slice(-20);
  }
  if (params.episode.toolNames.length > 0) {
    entry.toolNames = Array.from(new Set([...entry.toolNames, ...params.episode.toolNames])).slice(
      0,
      8,
    );
  }

  index.entries[scopedSignature] = entry;
  index.updatedAt = Date.now();
  await saveRepeatIndex(params.pathname, index);

  const crossedThreshold = before < thresholds.minCount && entry.count >= thresholds.minCount;
  return { index, entry, crossedThreshold };
}
