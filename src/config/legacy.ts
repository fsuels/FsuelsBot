import type { LegacyConfigIssue } from "./types.js";
import { LEGACY_CONFIG_MIGRATIONS } from "./legacy.migrations.js";
import { LEGACY_CONFIG_RULES } from "./legacy.rules.js";
import { createConfigMigrationRecorder, type ConfigMigrationEvent } from "./migration-helpers.js";

export function findLegacyConfigIssues(raw: unknown): LegacyConfigIssue[] {
  if (!raw || typeof raw !== "object") {
    return [];
  }
  const root = raw as Record<string, unknown>;
  const issues: LegacyConfigIssue[] = [];
  for (const rule of LEGACY_CONFIG_RULES) {
    let cursor: unknown = root;
    for (const key of rule.path) {
      if (!cursor || typeof cursor !== "object") {
        cursor = undefined;
        break;
      }
      cursor = (cursor as Record<string, unknown>)[key];
    }
    if (cursor !== undefined && (!rule.match || rule.match(cursor, root))) {
      issues.push({ path: rule.path.join("."), message: rule.message });
    }
  }
  return issues;
}

export function applyLegacyMigrations(raw: unknown): {
  next: Record<string, unknown> | null;
  changes: string[];
  events: ConfigMigrationEvent[];
  error?: string;
} {
  if (!raw || typeof raw !== "object") {
    return { next: null, changes: [], events: [] };
  }
  const next = structuredClone(raw) as Record<string, unknown>;
  const changes: string[] = [];
  const events: ConfigMigrationEvent[] = [];
  let applied = false;
  for (const migration of LEGACY_CONFIG_MIGRATIONS) {
    const changeCountBefore = changes.length;
    const recorder = createConfigMigrationRecorder(migration.id);
    try {
      migration.apply(next, changes, recorder);
    } catch (err) {
      const reason = String(err instanceof Error ? err.message : err);
      recorder.recordError({ reason });
      events.push(
        recorder.finalize({
          changed: changes.length > changeCountBefore,
          defaultAppliedReason: migration.describe,
          defaultSkippedReason: "migration failed",
        }),
      );
      return { next: null, changes, events, error: reason };
    }
    const event = recorder.finalize({
      changed: changes.length > changeCountBefore,
      defaultAppliedReason: migration.describe,
      defaultSkippedReason: "migration not applicable",
    });
    events.push(event);
    if (event.status === "applied") {
      applied = true;
    }
  }
  if (!applied) {
    return { next: null, changes: [], events };
  }
  return { next, changes, events };
}
