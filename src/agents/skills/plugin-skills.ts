import { createJiti } from "jiti";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { OpenClawConfig } from "../../config/config.js";
import {
  normalizePluginsConfig,
  resolveEnableState,
  resolveMemorySlotDecision,
} from "../../plugins/config-state.js";
import { loadPluginManifestRegistry } from "../../plugins/manifest-registry.js";
import { validateJsonSchemaValue } from "../../plugins/schema-validator.js";
import type {
  OpenClawPluginAvailabilityResult,
  OpenClawPluginDefinition,
  OpenClawPluginModule,
} from "../../plugins/types.js";
import { createPluginRuntime } from "../../plugins/runtime/index.js";
import { resolveUserPath } from "../../utils.js";

function resolvePluginSdkAlias(): string | null {
  try {
    const modulePath = fileURLToPath(import.meta.url);
    const isProduction = process.env.NODE_ENV === "production";
    const isTest = process.env.VITEST || process.env.NODE_ENV === "test";
    let cursor = path.dirname(modulePath);
    for (let i = 0; i < 6; i += 1) {
      const srcCandidate = path.join(cursor, "..", "..", "plugin-sdk", "index.ts");
      const distCandidate = path.join(cursor, "..", "..", "..", "dist", "plugin-sdk", "index.js");
      const orderedCandidates = isProduction
        ? isTest
          ? [distCandidate, srcCandidate]
          : [distCandidate]
        : [srcCandidate, distCandidate];
      for (const candidate of orderedCandidates) {
        const resolved = path.resolve(candidate);
        if (fs.existsSync(resolved)) {
          return resolved;
        }
      }
      const parent = path.dirname(cursor);
      if (parent === cursor) {
        break;
      }
      cursor = parent;
    }
  } catch {
    // ignore
  }
  return null;
}

function resolvePluginModuleExport(moduleExport: unknown): {
  definition?: OpenClawPluginDefinition;
  register?: OpenClawPluginDefinition["register"];
} {
  const resolved =
    moduleExport &&
    typeof moduleExport === "object" &&
    "default" in (moduleExport as Record<string, unknown>)
      ? (moduleExport as { default: unknown }).default
      : moduleExport;
  if (typeof resolved === "function") {
    return {
      register: resolved as OpenClawPluginDefinition["register"],
    };
  }
  if (resolved && typeof resolved === "object") {
    const def = resolved as OpenClawPluginDefinition;
    const register = def.register ?? def.activate;
    return { definition: def, register };
  }
  return {};
}

function normalizeAvailabilityResult(
  result: OpenClawPluginAvailabilityResult | undefined,
): { available: boolean; reason?: string } {
  if (typeof result === "boolean") {
    return { available: result };
  }
  if (!result || typeof result !== "object") {
    return { available: true };
  }
  const reason = typeof result.reason === "string" ? result.reason.trim() : "";
  return {
    available: result.available !== false,
    reason: reason || undefined,
  };
}

function validatePluginConfig(params: {
  schema?: Record<string, unknown>;
  cacheKey?: string;
  value?: unknown;
}): boolean {
  if (!params.schema) {
    return true;
  }
  const cacheKey = params.cacheKey ?? JSON.stringify(params.schema);
  return validateJsonSchemaValue({
    schema: params.schema,
    cacheKey,
    value: params.value ?? {},
  }).ok;
}

export function resolvePluginSkillDirs(params: {
  workspaceDir: string;
  config?: OpenClawConfig;
}): string[] {
  const workspaceDir = params.workspaceDir.trim();
  if (!workspaceDir) {
    return [];
  }

  const registry = loadPluginManifestRegistry({
    workspaceDir,
    config: params.config,
    cache: true,
  });
  const normalized = normalizePluginsConfig(params.config?.plugins);
  const memorySlot = normalized.slots.memory;
  let selectedMemoryPluginId: string | null = null;
  const seenPluginIds = new Set<string>();
  const seenDirs = new Set<string>();
  const resolved: string[] = [];
  const pluginSdkAlias = resolvePluginSdkAlias();
  const jiti = createJiti(import.meta.url, {
    interopDefault: true,
    extensions: [".ts", ".tsx", ".mts", ".cts", ".mtsx", ".ctsx", ".js", ".mjs", ".cjs", ".json"],
    ...(pluginSdkAlias
      ? {
          alias: { "openclaw/plugin-sdk": pluginSdkAlias },
        }
      : {}),
  });
  const runtime = createPluginRuntime();
  const noopLogger = {
    info: (_message: string) => {},
    warn: (_message: string) => {},
    error: (_message: string) => {},
    debug: (_message: string) => {},
  };

  for (const record of registry.plugins) {
    if (!Array.isArray(record.skills) || record.skills.length === 0) {
      continue;
    }
    if (seenPluginIds.has(record.id)) {
      continue;
    }
    seenPluginIds.add(record.id);

    const enableState = resolveEnableState(record.id, record.origin, normalized);
    if (!enableState.enabled) {
      continue;
    }

    const memoryDecision = resolveMemorySlotDecision({
      id: record.id,
      kind: record.kind,
      slot: memorySlot,
      selectedId: selectedMemoryPluginId,
    });
    if (!memoryDecision.enabled) {
      continue;
    }
    if (memoryDecision.selected && record.kind === "memory") {
      selectedMemoryPluginId = record.id;
    }

    const entry = normalized.entries[record.id];
    if (
      !validatePluginConfig({
        schema: record.configSchema,
        cacheKey: record.schemaCacheKey,
        value: entry?.config,
      })
    ) {
      continue;
    }

    let definition: OpenClawPluginDefinition | undefined;
    let register: OpenClawPluginDefinition["register"] | undefined;
    try {
      const resolvedModule = resolvePluginModuleExport(jiti(record.source) as OpenClawPluginModule);
      definition = resolvedModule.definition;
      register = resolvedModule.register;
    } catch {
      continue;
    }
    if (typeof register !== "function") {
      continue;
    }

    try {
      const availability = normalizeAvailabilityResult(
        definition?.isAvailable?.({
          config: params.config ?? {},
          pluginConfig: entry?.config as Record<string, unknown> | undefined,
          runtime,
          logger: noopLogger,
          workspaceDir,
          source: record.source,
          origin: record.origin,
        }),
      );
      if (!availability.available) {
        continue;
      }
    } catch {
      continue;
    }

    for (const rawSkillDir of record.skills) {
      const trimmed = rawSkillDir.trim();
      if (!trimmed) {
        continue;
      }
      const resolvedDir = resolveUserPath(path.resolve(record.rootDir, trimmed));
      if (!fs.existsSync(resolvedDir) || seenDirs.has(resolvedDir)) {
        continue;
      }
      seenDirs.add(resolvedDir);
      resolved.push(resolvedDir);
    }
  }

  return resolved;
}
