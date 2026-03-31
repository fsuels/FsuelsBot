import type { OpenClawConfig } from "../config/config.js";
import type { PluginInstallUpdate } from "./installs.js";
import type { PluginManifestRecord } from "./manifest-registry.js";
import type { PluginRecord } from "./registry.js";
import { enablePluginInConfig } from "./enable.js";
import { recordPluginInstall } from "./installs.js";
import { loadOpenClawPlugins } from "./loader.js";
import { loadPluginManifestRegistry } from "./manifest-registry.js";
import { applyExclusiveSlotSelection, defaultSlotIdForKey, type PluginSlotKey } from "./slots.js";

export type PluginLifecycleFailureCode =
  | "PLUGIN_NOT_FOUND"
  | "PLUGINS_DISABLED"
  | "BLOCKED_BY_DENYLIST"
  | "UNAVAILABLE"
  | "LOAD_FAILED";

export type PluginLifecycleResult =
  | {
      status: "changed" | "unchanged";
      config: OpenClawConfig;
      message: string;
      warnings: string[];
      plugin?: PluginManifestRecord;
    }
  | {
      status: "blocked";
      code: Exclude<PluginLifecycleFailureCode, "PLUGIN_NOT_FOUND">;
      config: OpenClawConfig;
      message: string;
      warnings: string[];
      plugin?: PluginManifestRecord;
      reason: string;
      remediation: string;
    }
  | {
      status: "not_found";
      code: "PLUGIN_NOT_FOUND";
      config: OpenClawConfig;
      message: string;
      warnings: string[];
      remediation: string;
    };

const SLOT_KEYS: PluginSlotKey[] = ["memory"];

function resolvePluginManifest(params: {
  config: OpenClawConfig;
  pluginId: string;
  workspaceDir?: string;
}): PluginManifestRecord | undefined {
  const registry = loadPluginManifestRegistry({
    config: params.config,
    workspaceDir: params.workspaceDir,
    cache: false,
  });
  return registry.plugins.find((entry) => entry.id === params.pluginId);
}

function addEntryEnabledFlag(
  config: OpenClawConfig,
  pluginId: string,
  enabled: boolean,
): OpenClawConfig {
  const currentEntry = config.plugins?.entries?.[pluginId] as Record<string, unknown> | undefined;
  if (currentEntry?.enabled === enabled) {
    return config;
  }
  return {
    ...config,
    plugins: {
      ...config.plugins,
      entries: {
        ...config.plugins?.entries,
        [pluginId]: {
          ...currentEntry,
          enabled,
        },
      },
    },
  };
}

function buildLifecycleRemediation(params: {
  code: PluginLifecycleFailureCode;
  pluginId: string;
  reason?: string;
}): string {
  switch (params.code) {
    case "PLUGIN_NOT_FOUND":
      return `Run \`openclaw plugins list\` to confirm the plugin id, or install \`${params.pluginId}\` before enabling it.`;
    case "PLUGINS_DISABLED":
      return "Set `plugins.enabled` to `true` before enabling individual plugins.";
    case "BLOCKED_BY_DENYLIST":
      return `Remove \`${params.pluginId}\` from \`plugins.deny\`, then retry the enable.`;
    case "UNAVAILABLE":
      return "Fix the environment requirement reported above, then rerun `openclaw plugins doctor`.";
    case "LOAD_FAILED":
      if (params.reason?.includes("invalid config")) {
        return `Run \`openclaw plugins configure ${params.pluginId}\` or update \`plugins.entries.${params.pluginId}.config\`, then retry the enable.`;
      }
      return "Run `openclaw plugins doctor` to inspect plugin load/config errors, then retry the enable.";
  }
}

function buildBlockedLifecycleResult(params: {
  config: OpenClawConfig;
  pluginId: string;
  plugin?: PluginManifestRecord;
  code: Exclude<PluginLifecycleFailureCode, "PLUGIN_NOT_FOUND">;
  reason: string;
}): Extract<PluginLifecycleResult, { status: "blocked" }> {
  return {
    status: "blocked",
    code: params.code,
    config: params.config,
    plugin: params.plugin,
    reason: params.reason,
    remediation: buildLifecycleRemediation({
      code: params.code,
      pluginId: params.pluginId,
      reason: params.reason,
    }),
    message: `Cannot enable plugin "${params.pluginId}": ${params.reason}.`,
    warnings: [],
  };
}

function resolveEnablePreflightFailure(params: {
  record?: PluginRecord;
  diagnostics?: Array<{ pluginId?: string; message: string }>;
  pluginId: string;
}): Extract<PluginLifecycleResult, { status: "blocked" }> | null {
  const record = params.record;
  if (!record) {
    const detail =
      params.diagnostics?.find((entry) => entry.pluginId === params.pluginId)?.message ??
      "plugin could not be resolved during enable preflight";
    return buildBlockedLifecycleResult({
      config: {},
      pluginId: params.pluginId,
      code: "LOAD_FAILED",
      reason: detail,
    });
  }

  switch (record.status) {
    case "loaded":
      return null;
    case "unavailable":
      return buildBlockedLifecycleResult({
        config: {},
        pluginId: params.pluginId,
        code: "UNAVAILABLE",
        reason: record.reason ?? "plugin unavailable in this environment",
      });
    case "error":
      return buildBlockedLifecycleResult({
        config: {},
        pluginId: params.pluginId,
        code: "LOAD_FAILED",
        reason: record.error ?? "plugin failed to load",
      });
    case "disabled":
      return buildBlockedLifecycleResult({
        config: {},
        pluginId: params.pluginId,
        code: "LOAD_FAILED",
        reason: record.reason ?? "plugin remained disabled after enable preflight",
      });
  }
}

function preflightEnablePlugin(params: {
  config: OpenClawConfig;
  pluginId: string;
  workspaceDir?: string;
  plugin?: PluginManifestRecord;
}): Extract<PluginLifecycleResult, { status: "blocked" }> | null {
  const registry = loadOpenClawPlugins({
    config: params.config,
    workspaceDir: params.workspaceDir,
    cache: false,
    mode: "validate",
  });
  if (!registry || !Array.isArray(registry.plugins)) {
    return null;
  }
  const record = registry.plugins.find((entry) => entry.id === params.pluginId);
  const failure = resolveEnablePreflightFailure({
    record,
    diagnostics: registry.diagnostics,
    pluginId: params.pluginId,
  });
  if (!failure) {
    return null;
  }
  return {
    ...failure,
    config: params.config,
    plugin: params.plugin,
  };
}

function disablePluginSlots(params: { config: OpenClawConfig; pluginId: string }): {
  config: OpenClawConfig;
  warnings: string[];
} {
  let slots = params.config.plugins?.slots;
  const warnings: string[] = [];

  for (const slotKey of SLOT_KEYS) {
    const explicit = slots?.[slotKey];
    const currentValue =
      typeof explicit === "string" && explicit.trim() ? explicit : defaultSlotIdForKey(slotKey);
    if (currentValue !== params.pluginId || explicit === "none") {
      continue;
    }
    if (slots === params.config.plugins?.slots) {
      slots = { ...slots };
    }
    slots = { ...slots, [slotKey]: "none" };
    warnings.push(`Exclusive slot "${slotKey}" disabled for "${params.pluginId}".`);
  }

  if (slots === params.config.plugins?.slots) {
    return { config: params.config, warnings: [] };
  }

  return {
    config: {
      ...params.config,
      plugins: {
        ...params.config.plugins,
        slots,
      },
    },
    warnings,
  };
}

export function addPluginLoadPath(config: OpenClawConfig, pluginPath: string): OpenClawConfig {
  const existing = config.plugins?.load?.paths ?? [];
  if (existing.includes(pluginPath)) {
    return config;
  }
  return {
    ...config,
    plugins: {
      ...config.plugins,
      load: {
        ...config.plugins?.load,
        paths: [...existing, pluginPath],
      },
    },
  };
}

export function enablePluginLifecycle(params: {
  config: OpenClawConfig;
  pluginId: string;
  workspaceDir?: string;
}): PluginLifecycleResult {
  const plugin = resolvePluginManifest(params);
  if (!plugin) {
    return {
      status: "not_found",
      code: "PLUGIN_NOT_FOUND",
      config: params.config,
      message: `Plugin not found: ${params.pluginId}`,
      warnings: [],
      remediation: buildLifecycleRemediation({
        code: "PLUGIN_NOT_FOUND",
        pluginId: params.pluginId,
      }),
    };
  }

  const enableResult = enablePluginInConfig(params.config, params.pluginId);
  if (!enableResult.enabled) {
    return buildBlockedLifecycleResult({
      config: params.config,
      pluginId: params.pluginId,
      plugin,
      code: enableResult.reason === "plugins disabled" ? "PLUGINS_DISABLED" : "BLOCKED_BY_DENYLIST",
      reason: enableResult.reason ?? "plugin disabled",
    });
  }

  const slotResult = applyExclusiveSlotSelection({
    config: enableResult.config,
    selectedId: params.pluginId,
    selectedKind: plugin.kind,
    registry: {
      plugins: loadPluginManifestRegistry({
        config: enableResult.config,
        workspaceDir: params.workspaceDir,
        cache: false,
      }).plugins.map((entry) => ({
        id: entry.id,
        kind: entry.kind,
      })),
    },
  });

  const preflightFailure = preflightEnablePlugin({
    config: slotResult.config,
    pluginId: params.pluginId,
    workspaceDir: params.workspaceDir,
    plugin,
  });
  if (preflightFailure) {
    return {
      ...preflightFailure,
      config: params.config,
    };
  }

  const changed = slotResult.config !== params.config;
  return {
    status: changed ? "changed" : "unchanged",
    config: slotResult.config,
    plugin,
    message: changed
      ? `Enabled plugin "${params.pluginId}".`
      : `Plugin "${params.pluginId}" is already enabled.`,
    warnings: slotResult.warnings,
  };
}

export function disablePluginLifecycle(params: {
  config: OpenClawConfig;
  pluginId: string;
  workspaceDir?: string;
}): PluginLifecycleResult {
  const plugin = resolvePluginManifest(params);
  if (!plugin) {
    return {
      status: "not_found",
      code: "PLUGIN_NOT_FOUND",
      config: params.config,
      message: `Plugin not found: ${params.pluginId}`,
      warnings: [],
      remediation: buildLifecycleRemediation({
        code: "PLUGIN_NOT_FOUND",
        pluginId: params.pluginId,
      }),
    };
  }
  let next = addEntryEnabledFlag(params.config, params.pluginId, false);
  const slotResult = disablePluginSlots({ config: next, pluginId: params.pluginId });
  next = slotResult.config;
  const changed = next !== params.config;
  return {
    status: changed ? "changed" : "unchanged",
    config: next,
    plugin,
    message: changed
      ? `Disabled plugin "${params.pluginId}".`
      : `Plugin "${params.pluginId}" is already disabled.`,
    warnings: slotResult.warnings,
  };
}

export function applyInstalledPluginState(params: {
  config: OpenClawConfig;
  pluginId: string;
  install?: PluginInstallUpdate;
  loadPath?: string;
  workspaceDir?: string;
}): PluginLifecycleResult {
  let next = params.config;
  if (params.loadPath) {
    next = addPluginLoadPath(next, params.loadPath);
  }
  if (params.install) {
    next = recordPluginInstall(next, params.install);
  }

  const result = enablePluginLifecycle({
    config: next,
    pluginId: params.pluginId,
    workspaceDir: params.workspaceDir,
  });

  if (result.status === "not_found") {
    return { ...result, config: next };
  }
  if (result.status === "blocked") {
    return { ...result, config: next };
  }
  return result;
}
