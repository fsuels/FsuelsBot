import type { OpenClawConfig } from "../config/config.js";

export type PluginEnableResult = {
  config: OpenClawConfig;
  enabled: boolean;
  reason?: string;
};

function ensureAllowlisted(cfg: OpenClawConfig, pluginId: string): OpenClawConfig {
  const allow = cfg.plugins?.allow;
  if (!Array.isArray(allow) || allow.includes(pluginId)) {
    return cfg;
  }
  return {
    ...cfg,
    plugins: {
      ...cfg.plugins,
      allow: [...allow, pluginId],
    },
  };
}

export function enablePluginInConfig(cfg: OpenClawConfig, pluginId: string): PluginEnableResult {
  if (cfg.plugins?.enabled === false) {
    return { config: cfg, enabled: false, reason: "plugins disabled" };
  }
  if (cfg.plugins?.deny?.includes(pluginId)) {
    return { config: cfg, enabled: false, reason: "blocked by denylist" };
  }

  const existingEntry = cfg.plugins?.entries?.[pluginId] as Record<string, unknown> | undefined;
  const alreadyEnabled = existingEntry?.enabled === true;
  let next = cfg;

  if (!alreadyEnabled) {
    const entries = {
      ...cfg.plugins?.entries,
      [pluginId]: {
        ...existingEntry,
        enabled: true,
      },
    };
    next = {
      ...cfg,
      plugins: {
        ...cfg.plugins,
        entries,
      },
    };
  }

  next = ensureAllowlisted(next, pluginId);
  return { config: next, enabled: true };
}
