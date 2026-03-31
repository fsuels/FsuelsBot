import type { OpenClawConfig } from "./types.js";
import { applyLegacyMigrations } from "./legacy.js";
import type { ConfigMigrationEvent } from "./migration-helpers.js";
import { validateConfigObjectWithPlugins } from "./validation.js";

export function migrateLegacyConfig(raw: unknown): {
  config: OpenClawConfig | null;
  changes: string[];
  events: ConfigMigrationEvent[];
  error?: string;
} {
  const { next, changes, events, error } = applyLegacyMigrations(raw);
  if (error) {
    return {
      config: null,
      changes: [...changes, `Migration failed: ${error}`],
      events,
      error,
    };
  }
  if (!next) {
    return { config: null, changes: [], events };
  }
  const validated = validateConfigObjectWithPlugins(next);
  if (!validated.ok) {
    changes.push("Migration applied, but config still invalid; fix remaining issues manually.");
    return { config: null, changes, events };
  }
  return { config: validated.config, changes, events };
}
