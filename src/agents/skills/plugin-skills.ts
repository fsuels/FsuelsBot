import type { OpenClawConfig } from "../../config/config.js";
import { loadOpenClawPlugins } from "../../plugins/loader.js";
import { resolveUserPath } from "../../utils.js";

export function resolvePluginSkillDirs(params: {
  workspaceDir: string;
  config?: OpenClawConfig;
}): string[] {
  const workspaceDir = params.workspaceDir.trim();
  if (!workspaceDir) {
    return [];
  }

  const registry = loadOpenClawPlugins({
    workspaceDir,
    config: params.config,
    mode: "validate",
    cache: false,
  });
  const seenDirs = new Set<string>();
  const resolved: string[] = [];

  for (const record of registry.plugins) {
    if (record.status !== "loaded" || record.skillDirs.length === 0) {
      continue;
    }
    for (const rawSkillDir of record.skillDirs) {
      const resolvedDir = resolveUserPath(rawSkillDir);
      if (!resolvedDir || seenDirs.has(resolvedDir)) {
        continue;
      }
      seenDirs.add(resolvedDir);
      resolved.push(resolvedDir);
    }
  }

  return resolved;
}
