import path from "node:path";
import { resolveStateDir } from "../../config/paths.js";
import { normalizeAgentId } from "../../routing/session-key.js";
import { CONFIG_DIR } from "../../utils.js";

export function resolveSkillFactoryDir(agentId?: string): string {
  const id = normalizeAgentId(agentId);
  return path.join(resolveStateDir(), "agents", id, "skill-factory");
}

export function resolveSkillFactoryEpisodesPath(agentId?: string): string {
  return path.join(resolveSkillFactoryDir(agentId), "episodes.jsonl");
}

export function resolveSkillFactoryRepeatIndexPath(agentId?: string): string {
  return path.join(resolveSkillFactoryDir(agentId), "repeat-index.json");
}

export function resolveSkillFactoryRegistryPath(agentId?: string): string {
  return path.join(resolveSkillFactoryDir(agentId), "registry.json");
}

export function resolveSkillFactoryEvalPath(agentId?: string): string {
  return path.join(resolveSkillFactoryDir(agentId), "evals.jsonl");
}

export function resolveSkillFactoryBackfillStatePath(agentId?: string): string {
  return path.join(resolveSkillFactoryDir(agentId), "backfill-state.json");
}

export function resolveSkillFactoryDraftsDir(agentId?: string): string {
  return path.join(resolveSkillFactoryDir(agentId), "drafts");
}

export function resolveSkillFactorySkillDraftDir(params: {
  agentId?: string;
  skillKey: string;
  hash: string;
}): string {
  return path.join(resolveSkillFactoryDraftsDir(params.agentId), params.skillKey, params.hash);
}

export function resolveManagedSkillsDir(): string {
  return path.join(CONFIG_DIR, "skills");
}

export function resolveManagedGeneratedSkillDir(skillKey: string): string {
  return path.join(resolveManagedSkillsDir(), `generated-${skillKey}`);
}
