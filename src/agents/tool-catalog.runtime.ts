import path from "node:path";
import type { OpenClawConfig } from "../config/config.js";
import { resolveStateDir } from "../config/paths.js";
import { loadPluginManifestRegistry } from "../plugins/manifest-registry.js";
import { resolveUserPath } from "../utils.js";
import { resolveAgentConfig, resolveDefaultAgentId } from "./agent-scope.js";
import { buildToolCatalog } from "./tool-catalog.js";

function resolveCatalogWorkspaceDir(config: OpenClawConfig, agentId: string) {
  const configuredWorkspace = resolveAgentConfig(config, agentId)?.workspace?.trim();
  if (configuredWorkspace) {
    return resolveUserPath(configuredWorkspace);
  }
  if (agentId === resolveDefaultAgentId(config)) {
    const defaultWorkspace = config.agents?.defaults?.workspace?.trim();
    if (defaultWorkspace) {
      return resolveUserPath(defaultWorkspace);
    }
  }
  const stateDir = resolveStateDir(process.env);
  return agentId === resolveDefaultAgentId(config)
    ? path.join(stateDir, "workspace")
    : path.join(stateDir, `workspace-${agentId}`);
}

export function resolveToolCatalogForAgent(config: OpenClawConfig, agentId?: string) {
  const resolvedAgentId = agentId?.trim() || resolveDefaultAgentId(config);
  const workspaceDir = resolveCatalogWorkspaceDir(config, resolvedAgentId);
  const registry = loadPluginManifestRegistry({
    config,
    workspaceDir,
  });
  return buildToolCatalog({
    pluginTools: registry.plugins.map((plugin) => ({
      pluginId: plugin.id,
      pluginName: plugin.name ?? plugin.id,
    })),
  });
}
