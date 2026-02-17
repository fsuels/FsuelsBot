import fs from "node:fs/promises";
import path from "node:path";
import type { SkillFactoryEpisode, SkillFactorySkillVersion } from "./types.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { resolveSkillFactorySkillDraftDir } from "./paths.js";
import { buildGeneratedSkillSafetyManifest } from "./safety.js";
import { sha256 } from "./signature.js";

const log = createSubsystemLogger("skill-factory");

function sanitizeToolKey(input: string): string {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  return normalized || "tool";
}

function toSkillKey(signature: string, toolName: string): string {
  const toolKey = sanitizeToolKey(toolName);
  return `workflow-${toolKey}-${signature.slice(0, 8)}`;
}

function selectDominantTool(episodes: SkillFactoryEpisode[]): string | null {
  const counts = new Map<string, number>();
  for (const episode of episodes) {
    for (const tool of episode.toolNames) {
      const key = tool.trim().toLowerCase();
      if (!key) {
        continue;
      }
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const ranked = [...counts.entries()].toSorted((a, b) => b[1] - a[1]);
  return ranked[0]?.[0] ?? null;
}

function buildSkillMarkdown(params: {
  skillName: string;
  signature: string;
  toolName: string;
}): string {
  const sig8 = params.signature.slice(0, 8).toLowerCase();
  const metadata = JSON.stringify(
    {
      openclaw: {
        skillKey: params.skillName,
        always: false,
      },
    },
    null,
    2,
  );
  return `---
name: ${params.skillName}
description: Auto-generated skill for repeated workflow pattern (${sig8})
user-invocable: true
disable-model-invocation: true
command-dispatch: tool
command-tool: ${params.toolName}
skill-factory-generated: true
metadata: ${metadata.replace(/\n/g, " ")}
---

# ${params.skillName}

Use this skill when handling repeated requests that match workflow signature \`${sig8}\`.

## Inputs

- Pass request-specific arguments after the command.
- Add \`--confirm\` when the action performs side effects.

## Behavior

- Deterministically dispatches to \`${params.toolName}\`.
- Enforced by \`skill.safety.json\`.
`;
}

export async function createSkillDraftFromEpisodes(params: {
  agentId?: string;
  signature: string;
  episodes: SkillFactoryEpisode[];
}): Promise<{
  skillKey: string;
  skillName: string;
  version: SkillFactorySkillVersion;
} | null> {
  if (params.episodes.length === 0) {
    return null;
  }
  const dominantTool = selectDominantTool(params.episodes);
  if (!dominantTool) {
    log.info(`skip draft for ${params.signature.slice(0, 8)}: no dominant tool`);
    return null;
  }

  const skillKey = toSkillKey(params.signature, dominantTool);
  const skillName = skillKey;
  const manifest = buildGeneratedSkillSafetyManifest({ toolName: dominantTool });
  const markdown = buildSkillMarkdown({
    skillName,
    signature: params.signature,
    toolName: dominantTool,
  });

  const artifactHash = sha256(`${markdown}\n${JSON.stringify(manifest)}`);
  const draftDir = resolveSkillFactorySkillDraftDir({
    agentId: params.agentId,
    skillKey,
    hash: artifactHash,
  });

  await fs.mkdir(draftDir, { recursive: true });
  await fs.writeFile(path.join(draftDir, "SKILL.md"), markdown, "utf-8");
  await fs.writeFile(
    path.join(draftDir, "skill.safety.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf-8",
  );

  const version: SkillFactorySkillVersion = {
    hash: artifactHash,
    createdAt: Date.now(),
    sourceSignature: params.signature,
    status: "draft",
    generated: true,
    skillName,
    dispatchTool: dominantTool,
    draftDir,
    manifestHash: sha256(JSON.stringify(manifest)),
  };

  return {
    skillKey,
    skillName,
    version,
  };
}
