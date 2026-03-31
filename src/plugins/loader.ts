import { createJiti } from "jiti";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { OpenClawConfig } from "../config/config.js";
import type { GatewayRequestHandler } from "../gateway/server-methods/types.js";
import type {
  OpenClawPluginDefinition,
  OpenClawPluginModule,
  OpenClawPluginAvailabilityResult,
  PluginDiagnostic,
  PluginLogger,
} from "./types.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { resolveUserPath } from "../utils.js";
import { clearPluginCommands } from "./commands.js";
import {
  normalizePluginsConfig,
  resolveEnableState,
  resolveMemorySlotDecision,
  type NormalizedPluginsConfig,
} from "./config-state.js";
import { discoverOpenClawPlugins } from "./discovery.js";
import { initializeGlobalHookRunner } from "./hook-runner-global.js";
import { loadPluginManifestRegistry } from "./manifest-registry.js";
import { createPluginRegistry, type PluginRecord, type PluginRegistry } from "./registry.js";
import { setActivePluginRegistry } from "./runtime.js";
import { createPluginRuntime } from "./runtime/index.js";
import { validateJsonSchemaValue } from "./schema-validator.js";

export type PluginLoadResult = PluginRegistry;

export type PluginLoadOptions = {
  config?: OpenClawConfig;
  workspaceDir?: string;
  logger?: PluginLogger;
  coreGatewayHandlers?: Record<string, GatewayRequestHandler>;
  cache?: boolean;
  mode?: "full" | "validate";
};

const registryCache = new Map<string, PluginRegistry>();

const defaultLogger = () => createSubsystemLogger("plugins");

const resolvePluginSdkAlias = (): string | null => {
  try {
    const modulePath = fileURLToPath(import.meta.url);
    const isProduction = process.env.NODE_ENV === "production";
    const isTest = process.env.VITEST || process.env.NODE_ENV === "test";
    let cursor = path.dirname(modulePath);
    for (let i = 0; i < 6; i += 1) {
      const srcCandidate = path.join(cursor, "src", "plugin-sdk", "index.ts");
      const distCandidate = path.join(cursor, "dist", "plugin-sdk", "index.js");
      const orderedCandidates = isProduction
        ? isTest
          ? [distCandidate, srcCandidate]
          : [distCandidate]
        : [srcCandidate, distCandidate];
      for (const candidate of orderedCandidates) {
        if (fs.existsSync(candidate)) {
          return candidate;
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
};

function buildCacheKey(params: {
  workspaceDir?: string;
  plugins: NormalizedPluginsConfig;
  mode: NonNullable<PluginLoadOptions["mode"]>;
}): string {
  const workspaceKey = params.workspaceDir ? resolveUserPath(params.workspaceDir) : "";
  return `${params.mode}::${workspaceKey}::${JSON.stringify(params.plugins)}`;
}

function validatePluginConfig(params: {
  schema?: Record<string, unknown>;
  cacheKey?: string;
  value?: unknown;
}): { ok: boolean; value?: Record<string, unknown>; errors?: string[] } {
  const schema = params.schema;
  if (!schema) {
    return { ok: true, value: params.value as Record<string, unknown> | undefined };
  }
  const cacheKey = params.cacheKey ?? JSON.stringify(schema);
  const result = validateJsonSchemaValue({
    schema,
    cacheKey,
    value: params.value ?? {},
  });
  if (result.ok) {
    return { ok: true, value: params.value as Record<string, unknown> | undefined };
  }
  return { ok: false, errors: result.errors };
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

function createPluginRecord(params: {
  id: string;
  name?: string;
  description?: string;
  version?: string;
  source: string;
  origin: PluginRecord["origin"];
  workspaceDir?: string;
  enabled: boolean;
  configSchema: boolean;
}): PluginRecord {
  return {
    id: params.id,
    name: params.name ?? params.id,
    description: params.description,
    version: params.version,
    source: params.source,
    origin: params.origin,
    workspaceDir: params.workspaceDir,
    enabled: params.enabled,
    available: true,
    status: params.enabled ? "loaded" : "disabled",
    reason: undefined,
    toolNames: [],
    hookNames: [],
    channelIds: [],
    providerIds: [],
    gatewayMethods: [],
    cliCommands: [],
    services: [],
    commands: [],
    skillDirs: [],
    httpHandlers: 0,
    hookCount: 0,
    configSchema: params.configSchema,
    configUiHints: undefined,
    configJsonSchema: undefined,
  };
}

function pushDiagnostics(diagnostics: PluginDiagnostic[], append: PluginDiagnostic[]) {
  diagnostics.push(...append);
}

export function loadOpenClawPlugins(options: PluginLoadOptions = {}): PluginRegistry {
  const cfg = options.config ?? {};
  const logger = options.logger ?? defaultLogger();
  const validateOnly = options.mode === "validate";
  const mode = options.mode ?? "full";
  const normalized = normalizePluginsConfig(cfg.plugins);
  const cacheKey = buildCacheKey({
    workspaceDir: options.workspaceDir,
    plugins: normalized,
    mode,
  });
  const cacheEnabled = options.cache !== false;
  if (cacheEnabled) {
    const cached = registryCache.get(cacheKey);
    if (cached) {
      if (!validateOnly) {
        setActivePluginRegistry(cached, cacheKey);
      }
      return cached;
    }
  }

  if (!validateOnly) {
    // Clear previously registered plugin commands before reloading
    clearPluginCommands();
  }

  const runtime = createPluginRuntime();
  const { registry, createApi } = createPluginRegistry({
    logger,
    runtime,
    coreGatewayHandlers: options.coreGatewayHandlers as Record<string, GatewayRequestHandler>,
  });

  const discovery = discoverOpenClawPlugins({
    workspaceDir: options.workspaceDir,
    extraPaths: normalized.loadPaths,
  });
  const manifestRegistry = loadPluginManifestRegistry({
    config: cfg,
    workspaceDir: options.workspaceDir,
    cache: options.cache,
    candidates: discovery.candidates,
    diagnostics: discovery.diagnostics,
  });
  pushDiagnostics(registry.diagnostics, manifestRegistry.diagnostics);

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

  const manifestByRoot = new Map(
    manifestRegistry.plugins.map((record) => [record.rootDir, record]),
  );

  const seenIds = new Map<string, PluginRecord["origin"]>();
  const memorySlot = normalized.slots.memory;
  let selectedMemoryPluginId: string | null = null;
  let memorySlotMatched = false;

  for (const candidate of discovery.candidates) {
    const manifestRecord = manifestByRoot.get(candidate.rootDir);
    if (!manifestRecord) {
      continue;
    }
    const pluginId = manifestRecord.id;
    const existingOrigin = seenIds.get(pluginId);
    if (existingOrigin) {
      const record = createPluginRecord({
        id: pluginId,
        name: manifestRecord.name ?? pluginId,
        description: manifestRecord.description,
        version: manifestRecord.version,
        source: candidate.source,
        origin: candidate.origin,
        workspaceDir: candidate.workspaceDir,
        enabled: false,
        configSchema: Boolean(manifestRecord.configSchema),
      });
      record.status = "disabled";
      record.reason = `overridden by ${existingOrigin} plugin`;
      registry.plugins.push(record);
      continue;
    }

    const enableState = resolveEnableState(pluginId, candidate.origin, normalized);
    const entry = normalized.entries[pluginId];
    const record = createPluginRecord({
      id: pluginId,
      name: manifestRecord.name ?? pluginId,
      description: manifestRecord.description,
      version: manifestRecord.version,
      source: candidate.source,
      origin: candidate.origin,
      workspaceDir: candidate.workspaceDir,
      enabled: enableState.enabled,
      configSchema: Boolean(manifestRecord.configSchema),
    });
    record.kind = manifestRecord.kind;
    record.configUiHints = manifestRecord.configUiHints;
    record.configJsonSchema = manifestRecord.configSchema;
    if (Array.isArray(manifestRecord.skills)) {
      const seenSkillDirs = new Set<string>();
      for (const rawSkillDir of manifestRecord.skills) {
        const trimmed = rawSkillDir.trim();
        if (!trimmed) {
          continue;
        }
        const resolvedSkillDir = path.resolve(manifestRecord.rootDir, trimmed);
        if (!fs.existsSync(resolvedSkillDir)) {
          registry.diagnostics.push({
            level: "warn",
            pluginId: record.id,
            source: manifestRecord.manifestPath,
            message: `plugin skill path not found: ${resolvedSkillDir}`,
          });
          continue;
        }
        if (seenSkillDirs.has(resolvedSkillDir)) {
          continue;
        }
        seenSkillDirs.add(resolvedSkillDir);
        record.skillDirs.push(resolvedSkillDir);
      }
    }

    if (!enableState.enabled) {
      record.status = "disabled";
      record.reason = enableState.reason;
      registry.plugins.push(record);
      seenIds.set(pluginId, candidate.origin);
      continue;
    }

    if (!manifestRecord.configSchema) {
      record.status = "error";
      record.error = "missing config schema";
      registry.plugins.push(record);
      seenIds.set(pluginId, candidate.origin);
      registry.diagnostics.push({
        level: "error",
        pluginId: record.id,
        source: record.source,
        message: record.error,
      });
      continue;
    }

    let mod: OpenClawPluginModule | null = null;
    try {
      mod = jiti(candidate.source) as OpenClawPluginModule;
    } catch (err) {
      logger.error(`[plugins] ${record.id} failed to load from ${record.source}: ${String(err)}`);
      record.status = "error";
      record.error = String(err);
      registry.plugins.push(record);
      seenIds.set(pluginId, candidate.origin);
      registry.diagnostics.push({
        level: "error",
        pluginId: record.id,
        source: record.source,
        message: `failed to load plugin: ${String(err)}`,
      });
      continue;
    }

    const resolved = resolvePluginModuleExport(mod);
    const definition = resolved.definition;
    const register = resolved.register;

    if (definition?.id && definition.id !== record.id) {
      registry.diagnostics.push({
        level: "warn",
        pluginId: record.id,
        source: record.source,
        message: `plugin id mismatch (config uses "${record.id}", export uses "${definition.id}")`,
      });
    }

    record.name = definition?.name ?? record.name;
    record.description = definition?.description ?? record.description;
    record.version = definition?.version ?? record.version;
    const manifestKind = record.kind as string | undefined;
    const exportKind = definition?.kind as string | undefined;
    if (manifestKind && exportKind && exportKind !== manifestKind) {
      registry.diagnostics.push({
        level: "warn",
        pluginId: record.id,
        source: record.source,
        message: `plugin kind mismatch (manifest uses "${manifestKind}", export uses "${exportKind}")`,
      });
    }
    record.kind = definition?.kind ?? record.kind;

    if (record.kind === "memory" && memorySlot === record.id) {
      memorySlotMatched = true;
    }

    const memoryDecision = resolveMemorySlotDecision({
      id: record.id,
      kind: record.kind,
      slot: memorySlot,
      selectedId: selectedMemoryPluginId,
    });

    if (!memoryDecision.enabled) {
      record.enabled = false;
      record.status = "disabled";
      record.reason = memoryDecision.reason;
      registry.plugins.push(record);
      seenIds.set(pluginId, candidate.origin);
      continue;
    }

    if (memoryDecision.selected && record.kind === "memory") {
      selectedMemoryPluginId = record.id;
    }

    const validatedConfig = validatePluginConfig({
      schema: manifestRecord.configSchema,
      cacheKey: manifestRecord.schemaCacheKey,
      value: entry?.config,
    });

    if (!validatedConfig.ok) {
      logger.error(`[plugins] ${record.id} invalid config: ${validatedConfig.errors?.join(", ")}`);
      record.status = "error";
      record.error = `invalid config: ${validatedConfig.errors?.join(", ")}`;
      registry.plugins.push(record);
      seenIds.set(pluginId, candidate.origin);
      registry.diagnostics.push({
        level: "error",
        pluginId: record.id,
        source: record.source,
        message: record.error,
      });
      continue;
    }

    if (typeof register !== "function") {
      logger.error(`[plugins] ${record.id} missing register/activate export`);
      record.status = "error";
      record.error = "plugin export missing register/activate";
      registry.plugins.push(record);
      seenIds.set(pluginId, candidate.origin);
      registry.diagnostics.push({
        level: "error",
        pluginId: record.id,
        source: record.source,
        message: record.error,
      });
      continue;
    }

    let availability: { available: boolean; reason?: string };
    try {
      availability = normalizeAvailabilityResult(
        definition?.isAvailable?.({
          config: cfg,
          pluginConfig: validatedConfig.value,
          runtime,
          logger,
          workspaceDir: candidate.workspaceDir,
          source: record.source,
          origin: record.origin,
        }),
      );
    } catch (err) {
      logger.error(
        `[plugins] ${record.id} availability check failed from ${record.source}: ${String(err)}`,
      );
      record.status = "error";
      record.error = `plugin availability check failed: ${String(err)}`;
      registry.plugins.push(record);
      seenIds.set(pluginId, candidate.origin);
      registry.diagnostics.push({
        level: "error",
        pluginId: record.id,
        source: record.source,
        message: record.error,
      });
      continue;
    }
    record.available = availability.available;
    if (!availability.available) {
      record.status = "unavailable";
      record.reason = availability.reason ?? "plugin unavailable in this environment";
      registry.plugins.push(record);
      seenIds.set(pluginId, candidate.origin);
      continue;
    }

    if (validateOnly) {
      registry.plugins.push(record);
      seenIds.set(pluginId, candidate.origin);
      continue;
    }

    const api = createApi(record, {
      config: cfg,
      pluginConfig: validatedConfig.value,
    });

    try {
      const result = register(api);
      if (result && typeof result.then === "function") {
        registry.diagnostics.push({
          level: "warn",
          pluginId: record.id,
          source: record.source,
          message: "plugin register returned a promise; async registration is ignored",
        });
      }
      registry.plugins.push(record);
      seenIds.set(pluginId, candidate.origin);
    } catch (err) {
      logger.error(
        `[plugins] ${record.id} failed during register from ${record.source}: ${String(err)}`,
      );
      record.status = "error";
      record.error = String(err);
      registry.plugins.push(record);
      seenIds.set(pluginId, candidate.origin);
      registry.diagnostics.push({
        level: "error",
        pluginId: record.id,
        source: record.source,
        message: `plugin failed during register: ${String(err)}`,
      });
    }
  }

  if (typeof memorySlot === "string" && !memorySlotMatched) {
    registry.diagnostics.push({
      level: "warn",
      message: `memory slot plugin not found or not marked as memory: ${memorySlot}`,
    });
  }

  if (cacheEnabled) {
    registryCache.set(cacheKey, registry);
  }
  if (!validateOnly) {
    setActivePluginRegistry(registry, cacheKey);
    initializeGlobalHookRunner(registry);
  }
  return registry;
}
