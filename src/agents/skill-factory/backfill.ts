import fs from "node:fs/promises";
import path from "node:path";
import type { SkillFactoryBackfillState } from "./types.js";
import { resolveSessionTranscriptsDirForAgent } from "../../config/sessions/paths.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { normalizeAgentId } from "../../routing/session-key.js";
import { extractToolCallNames } from "../../utils/transcript-tools.js";
import { buildEpisodeIdSet } from "./episodes.js";
import { buildSkillFactoryEpisode, processSkillFactoryEpisode } from "./orchestrator.js";
import { resolveSkillFactoryBackfillStatePath, resolveSkillFactoryEpisodesPath } from "./paths.js";
import { sha256 } from "./signature.js";

const log = createSubsystemLogger("skill-factory");

function createBackfillState(): SkillFactoryBackfillState {
  return {
    version: 1,
    updatedAt: Date.now(),
    files: {},
  };
}

async function loadBackfillState(pathname: string): Promise<SkillFactoryBackfillState> {
  try {
    const raw = await fs.readFile(pathname, "utf-8");
    const parsed = JSON.parse(raw) as SkillFactoryBackfillState;
    if (!parsed || parsed.version !== 1 || typeof parsed.files !== "object") {
      return createBackfillState();
    }
    return parsed;
  } catch {
    return createBackfillState();
  }
}

async function saveBackfillState(
  pathname: string,
  state: SkillFactoryBackfillState,
): Promise<void> {
  await fs.mkdir(path.dirname(pathname), { recursive: true });
  const tmp = `${pathname}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
  await fs.rename(tmp, pathname);
}

function extractTextFromContent(content: unknown): string | null {
  if (typeof content === "string") {
    const trimmed = content.trim();
    return trimmed ? trimmed : null;
  }
  if (!Array.isArray(content)) {
    return null;
  }
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") {
      continue;
    }
    const record = block as { type?: unknown; text?: unknown };
    if (record.type === "text" && typeof record.text === "string") {
      parts.push(record.text);
    }
  }
  const merged = parts.join(" ").replace(/\s+/g, " ").trim();
  return merged || null;
}

function parseTimestampMs(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.floor(value);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return Math.floor(parsed);
    }
  }
  return Date.now();
}

export async function backfillSkillFactoryEpisodes(params: {
  agentId?: string;
  workspaceDir?: string;
  full?: boolean;
}): Promise<{
  processedFiles: number;
  skippedFiles: number;
  createdEpisodes: number;
  skippedEpisodes: number;
}> {
  const agentId = params.agentId ? normalizeAgentId(params.agentId) : undefined;
  const sessionDir = resolveSessionTranscriptsDirForAgent(agentId);
  const statePath = resolveSkillFactoryBackfillStatePath(agentId);
  const episodesPath = resolveSkillFactoryEpisodesPath(agentId);
  const state = params.full ? createBackfillState() : await loadBackfillState(statePath);
  const existingEpisodeIds = await buildEpisodeIdSet(episodesPath);

  let processedFiles = 0;
  let skippedFiles = 0;
  let createdEpisodes = 0;
  let skippedEpisodes = 0;

  let entries: Array<{ absPath: string; name: string }> = [];
  try {
    const files = await fs.readdir(sessionDir, { withFileTypes: true });
    entries = files
      .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
      .map((entry) => ({ absPath: path.join(sessionDir, entry.name), name: entry.name }));
  } catch {
    return { processedFiles, skippedFiles, createdEpisodes, skippedEpisodes };
  }

  for (const entry of entries) {
    const raw = await fs.readFile(entry.absPath, "utf-8").catch(() => "");
    if (!raw) {
      continue;
    }
    const hash = sha256(raw);
    const previous = state.files[entry.absPath];
    if (previous?.hash === hash && !params.full) {
      skippedFiles += 1;
      continue;
    }

    processedFiles += 1;
    const lines = raw.split("\n");
    let pendingUser: { text: string; ts: number; role: string } | null = null;
    let sessionId = entry.name.replace(/\.jsonl$/, "");

    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      if (!parsed || typeof parsed !== "object") {
        continue;
      }
      const record = parsed as {
        type?: unknown;
        id?: unknown;
        timestamp?: unknown;
        message?: {
          role?: unknown;
          content?: unknown;
          provider?: unknown;
          model?: unknown;
          toolName?: unknown;
          tool_name?: unknown;
        };
      };

      if (record.type === "session" && typeof record.id === "string") {
        sessionId = record.id;
        continue;
      }
      if (record.type !== "message" || !record.message || typeof record.message !== "object") {
        continue;
      }

      const role = typeof record.message.role === "string" ? record.message.role : "";
      const text = extractTextFromContent(record.message.content);
      if (!text) {
        continue;
      }
      const ts = parseTimestampMs(record.timestamp);

      if (role === "user") {
        pendingUser = { text, ts, role };
        continue;
      }

      if (role !== "assistant" || !pendingUser) {
        continue;
      }

      const runId = sha256(`${entry.absPath}:${pendingUser.ts}:${ts}:${pendingUser.text}`);
      const toolNames = extractToolCallNames(record.message as Record<string, unknown>);
      const candidateEpisode = buildSkillFactoryEpisode({
        agentId: agentId ?? "main",
        workspaceDir: params.workspaceDir,
        sessionId,
        runId,
        source: "backfill",
        prompt: pendingUser.text,
        toolNames,
        startedAt: pendingUser.ts,
        endedAt: Math.max(pendingUser.ts, ts),
        provider: typeof record.message.provider === "string" ? record.message.provider : undefined,
        model: typeof record.message.model === "string" ? record.message.model : undefined,
        outcome: "success",
      });
      const episodeId = candidateEpisode.id;
      if (existingEpisodeIds.has(episodeId)) {
        skippedEpisodes += 1;
        pendingUser = null;
        continue;
      }

      await processSkillFactoryEpisode({
        agentId: agentId ?? "main",
        workspaceDir: params.workspaceDir,
        sessionId,
        runId,
        source: "backfill",
        prompt: pendingUser.text,
        toolNames,
        startedAt: pendingUser.ts,
        endedAt: Math.max(pendingUser.ts, ts),
        provider: typeof record.message.provider === "string" ? record.message.provider : undefined,
        model: typeof record.message.model === "string" ? record.message.model : undefined,
        outcome: "success",
      });
      existingEpisodeIds.add(episodeId);
      createdEpisodes += 1;
      pendingUser = null;
    }

    state.files[entry.absPath] = {
      hash,
      updatedAt: Date.now(),
    };
  }

  state.updatedAt = Date.now();
  await saveBackfillState(statePath, state);
  log.info(
    `backfill complete: processedFiles=${processedFiles} skippedFiles=${skippedFiles} ` +
      `createdEpisodes=${createdEpisodes} skippedEpisodes=${skippedEpisodes}`,
  );

  return {
    processedFiles,
    skippedFiles,
    createdEpisodes,
    skippedEpisodes,
  };
}
