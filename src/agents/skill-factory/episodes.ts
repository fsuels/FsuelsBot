import fs from "node:fs/promises";
import path from "node:path";
import type { SkillFactoryEpisode } from "./types.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";

const log = createSubsystemLogger("skill-factory");

function safeParseEpisode(line: string): SkillFactoryEpisode | null {
  if (!line.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(line) as SkillFactoryEpisode;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    if (typeof parsed.id !== "string" || typeof parsed.intentSignature !== "string") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function appendEpisode(pathname: string, episode: SkillFactoryEpisode): Promise<void> {
  await fs.mkdir(path.dirname(pathname), { recursive: true });
  await fs.appendFile(pathname, `${JSON.stringify(episode)}\n`, "utf-8");
}

export async function appendEpisodes(
  pathname: string,
  episodes: SkillFactoryEpisode[],
): Promise<void> {
  if (episodes.length === 0) {
    return;
  }
  await fs.mkdir(path.dirname(pathname), { recursive: true });
  const payload = episodes.map((episode) => JSON.stringify(episode)).join("\n") + "\n";
  await fs.appendFile(pathname, payload, "utf-8");
}

export async function loadEpisodes(params: {
  pathname: string;
  signature?: string;
  max?: number;
}): Promise<SkillFactoryEpisode[]> {
  let raw = "";
  try {
    raw = await fs.readFile(params.pathname, "utf-8");
  } catch {
    return [];
  }
  const lines = raw.split("\n");
  const episodes: SkillFactoryEpisode[] = [];
  for (const line of lines) {
    const parsed = safeParseEpisode(line);
    if (!parsed) {
      continue;
    }
    if (params.signature && parsed.intentSignature !== params.signature) {
      continue;
    }
    episodes.push(parsed);
  }
  if (typeof params.max === "number" && params.max > 0 && episodes.length > params.max) {
    return episodes.slice(-params.max);
  }
  return episodes;
}

export async function buildEpisodeIdSet(pathname: string): Promise<Set<string>> {
  const episodes = await loadEpisodes({ pathname });
  return new Set(episodes.map((episode) => episode.id));
}

export function sortEpisodesByTime(episodes: SkillFactoryEpisode[]): SkillFactoryEpisode[] {
  return episodes.slice().toSorted((a, b) => a.startedAt - b.startedAt);
}

export function medianDurationMs(episodes: SkillFactoryEpisode[]): number {
  if (episodes.length === 0) {
    return 0;
  }
  const sorted = episodes
    .map((episode) => Math.max(0, Math.floor(episode.durationMs || 0)))
    .toSorted((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
  }
  return sorted[mid] ?? 0;
}

export function safeLogEpisodeError(message: string, error: unknown) {
  log.warn(`${message}: ${error instanceof Error ? error.message : String(error)}`);
}
