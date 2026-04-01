import type { OpenClawConfig, ConfigValidationIssue } from "./types.js";
import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../agents/agent-scope.js";
import { describeToolSelectorIssue, findToolSelectorIssues } from "../agents/tool-catalog.js";
import { resolveToolCatalogForAgent } from "../agents/tool-catalog.runtime.js";
import { CHANNEL_IDS, normalizeChatChannelId } from "../channels/registry.js";
import {
  normalizePluginsConfig,
  resolveEnableState,
  resolveMemorySlotDecision,
} from "../plugins/config-state.js";
import { loadPluginManifestRegistry } from "../plugins/manifest-registry.js";
import { validateJsonSchemaValue } from "../plugins/schema-validator.js";
import { validateConfigObject } from "./validation.base.js";
export { validateConfigObject } from "./validation.base.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

type ToolPolicyLike = {
  allow?: string[];
  alsoAllow?: string[];
  deny?: string[];
};

function pushToolPolicyIssues(params: {
  policy: ToolPolicyLike | undefined;
  pathPrefix: string;
  catalog: ReturnType<typeof resolveToolCatalogForAgent>;
  issues: ConfigValidationIssue[];
}) {
  const entries = [
    ["allow", params.policy?.allow],
    ["alsoAllow", params.policy?.alsoAllow],
    ["deny", params.policy?.deny],
  ] as const;
  for (const [field, list] of entries) {
    const selectorIssues = findToolSelectorIssues(list, params.catalog);
    for (const issue of selectorIssues) {
      params.issues.push({
        path: `${params.pathPrefix}.${field}`,
        message: describeToolSelectorIssue(issue),
      });
    }
  }
}

export function validateConfigObjectWithPlugins(raw: unknown):
  | {
      ok: true;
      config: OpenClawConfig;
      warnings: ConfigValidationIssue[];
    }
  | {
      ok: false;
      issues: ConfigValidationIssue[];
      warnings: ConfigValidationIssue[];
    } {
  const base = validateConfigObject(raw);
  if (!base.ok) {
    return { ok: false, issues: base.issues, warnings: [] };
  }

  const config = base.config;
  const issues: ConfigValidationIssue[] = [];
  const warnings: ConfigValidationIssue[] = [];
  const toolCatalog = resolveToolCatalogForAgent(config, resolveDefaultAgentId(config));
  const pluginsConfig = config.plugins;
  const normalizedPlugins = normalizePluginsConfig(pluginsConfig);

  const workspaceDir = resolveAgentWorkspaceDir(config, resolveDefaultAgentId(config));
  const registry = loadPluginManifestRegistry({
    config,
    workspaceDir: workspaceDir ?? undefined,
  });

  const knownIds = new Set(registry.plugins.map((record) => record.id));

  for (const diag of registry.diagnostics) {
    let path = diag.pluginId ? `plugins.entries.${diag.pluginId}` : "plugins";
    if (!diag.pluginId && diag.message.includes("plugin path not found")) {
      path = "plugins.load.paths";
    }
    const pluginLabel = diag.pluginId ? `plugin ${diag.pluginId}` : "plugin";
    const message = `${pluginLabel}: ${diag.message}`;
    if (diag.level === "error") {
      issues.push({ path, message });
    } else {
      warnings.push({ path, message });
    }
  }

  const entries = pluginsConfig?.entries;
  if (entries && isRecord(entries)) {
    for (const pluginId of Object.keys(entries)) {
      if (!knownIds.has(pluginId)) {
        issues.push({
          path: `plugins.entries.${pluginId}`,
          message: `plugin not found: ${pluginId}`,
        });
      }
    }
  }

  const allow = pluginsConfig?.allow ?? [];
  for (const pluginId of allow) {
    if (typeof pluginId !== "string" || !pluginId.trim()) {
      continue;
    }
    if (!knownIds.has(pluginId)) {
      issues.push({
        path: "plugins.allow",
        message: `plugin not found: ${pluginId}`,
      });
    }
  }

  const deny = pluginsConfig?.deny ?? [];
  for (const pluginId of deny) {
    if (typeof pluginId !== "string" || !pluginId.trim()) {
      continue;
    }
    if (!knownIds.has(pluginId)) {
      issues.push({
        path: "plugins.deny",
        message: `plugin not found: ${pluginId}`,
      });
    }
  }

  const memorySlot = normalizedPlugins.slots.memory;
  if (typeof memorySlot === "string" && memorySlot.trim() && !knownIds.has(memorySlot)) {
    issues.push({
      path: "plugins.slots.memory",
      message: `plugin not found: ${memorySlot}`,
    });
  }

  const allowedChannels = new Set<string>(["defaults", ...CHANNEL_IDS]);
  for (const record of registry.plugins) {
    for (const channelId of record.channels) {
      allowedChannels.add(channelId);
    }
  }

  if (config.channels && isRecord(config.channels)) {
    for (const key of Object.keys(config.channels)) {
      const trimmed = key.trim();
      if (!trimmed) {
        continue;
      }
      if (!allowedChannels.has(trimmed)) {
        issues.push({
          path: `channels.${trimmed}`,
          message: `unknown channel id: ${trimmed}`,
        });
      }
    }
  }

  const heartbeatChannelIds = new Set<string>();
  for (const channelId of CHANNEL_IDS) {
    heartbeatChannelIds.add(channelId.toLowerCase());
  }
  for (const record of registry.plugins) {
    for (const channelId of record.channels) {
      const trimmed = channelId.trim();
      if (trimmed) {
        heartbeatChannelIds.add(trimmed.toLowerCase());
      }
    }
  }

  const validateHeartbeatTarget = (target: string | undefined, path: string) => {
    if (typeof target !== "string") {
      return;
    }
    const trimmed = target.trim();
    if (!trimmed) {
      issues.push({ path, message: "heartbeat target must not be empty" });
      return;
    }
    const normalized = trimmed.toLowerCase();
    if (normalized === "last" || normalized === "none") {
      return;
    }
    if (normalizeChatChannelId(trimmed)) {
      return;
    }
    if (heartbeatChannelIds.has(normalized)) {
      return;
    }
    issues.push({ path, message: `unknown heartbeat target: ${target}` });
  };

  validateHeartbeatTarget(
    config.agents?.defaults?.heartbeat?.target,
    "agents.defaults.heartbeat.target",
  );
  if (Array.isArray(config.agents?.list)) {
    for (const [index, entry] of config.agents.list.entries()) {
      validateHeartbeatTarget(entry?.heartbeat?.target, `agents.list.${index}.heartbeat.target`);
    }
  }

  pushToolPolicyIssues({
    policy: config.tools,
    pathPrefix: "tools",
    catalog: toolCatalog,
    issues,
  });

  if (config.tools?.sandbox?.tools) {
    pushToolPolicyIssues({
      policy: config.tools.sandbox.tools,
      pathPrefix: "tools.sandbox.tools",
      catalog: toolCatalog,
      issues,
    });
  }

  if (config.tools?.subagents?.tools) {
    pushToolPolicyIssues({
      policy: config.tools.subagents.tools,
      pathPrefix: "tools.subagents.tools",
      catalog: toolCatalog,
      issues,
    });
  }

  if (isRecord(config.tools?.byProvider)) {
    for (const [providerKey, policy] of Object.entries(config.tools.byProvider)) {
      pushToolPolicyIssues({
        policy: isRecord(policy) ? (policy as ToolPolicyLike) : undefined,
        pathPrefix: `tools.byProvider.${providerKey}`,
        catalog: toolCatalog,
        issues,
      });
    }
  }

  if (Array.isArray(config.agents?.list)) {
    for (const [index, entry] of config.agents.list.entries()) {
      pushToolPolicyIssues({
        policy: entry?.tools,
        pathPrefix: `agents.list.${index}.tools`,
        catalog: toolCatalog,
        issues,
      });
      if (entry?.tools?.sandbox?.tools) {
        pushToolPolicyIssues({
          policy: entry.tools.sandbox.tools,
          pathPrefix: `agents.list.${index}.tools.sandbox.tools`,
          catalog: toolCatalog,
          issues,
        });
      }
      if (isRecord(entry?.tools?.byProvider)) {
        for (const [providerKey, policy] of Object.entries(entry.tools.byProvider)) {
          pushToolPolicyIssues({
            policy: isRecord(policy) ? (policy as ToolPolicyLike) : undefined,
            pathPrefix: `agents.list.${index}.tools.byProvider.${providerKey}`,
            catalog: toolCatalog,
            issues,
          });
        }
      }
    }
  }

  let selectedMemoryPluginId: string | null = null;
  const seenPlugins = new Set<string>();
  for (const record of registry.plugins) {
    const pluginId = record.id;
    if (seenPlugins.has(pluginId)) {
      continue;
    }
    seenPlugins.add(pluginId);
    const entry = normalizedPlugins.entries[pluginId];
    const entryHasConfig = Boolean(entry?.config);

    const enableState = resolveEnableState(pluginId, record.origin, normalizedPlugins);
    let enabled = enableState.enabled;
    let reason = enableState.reason;

    if (enabled) {
      const memoryDecision = resolveMemorySlotDecision({
        id: pluginId,
        kind: record.kind,
        slot: memorySlot,
        selectedId: selectedMemoryPluginId,
      });
      if (!memoryDecision.enabled) {
        enabled = false;
        reason = memoryDecision.reason;
      }
      if (memoryDecision.selected && record.kind === "memory") {
        selectedMemoryPluginId = pluginId;
      }
    }

    const shouldValidate = enabled || entryHasConfig;
    if (shouldValidate) {
      if (record.configSchema) {
        const res = validateJsonSchemaValue({
          schema: record.configSchema,
          cacheKey: record.schemaCacheKey ?? record.manifestPath ?? pluginId,
          value: entry?.config ?? {},
        });
        if (!res.ok) {
          for (const error of res.errors) {
            issues.push({
              path: `plugins.entries.${pluginId}.config`,
              message: `invalid config: ${error}`,
            });
          }
        }
      } else {
        issues.push({
          path: `plugins.entries.${pluginId}`,
          message: `plugin schema missing for ${pluginId}`,
        });
      }
    }

    if (!enabled && entryHasConfig) {
      warnings.push({
        path: `plugins.entries.${pluginId}`,
        message: `plugin disabled (${reason ?? "disabled"}) but config is present`,
      });
    }
  }

  if (issues.length > 0) {
    return { ok: false, issues, warnings };
  }

  return { ok: true, config, warnings };
}
