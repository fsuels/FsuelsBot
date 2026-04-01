import JSON5 from "json5";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { OpenClawConfig } from "./types.js";
import { resolveRequiredHomeDir } from "../infra/home-dir.js";
import { stripUtf8Bom } from "../infra/json-parse.js";
import {
  loadShellEnvFallback,
  resolveShellEnvFallbackTimeoutMs,
  shouldDeferShellEnvFallback,
  shouldEnableShellEnvFallback,
} from "../infra/shell-env.js";
import { VERSION } from "../version.js";
import {
  applyCompactionDefaults,
  applyContextPruningDefaults,
  applyAgentDefaults,
  applyLoggingDefaults,
  applyMessageDefaults,
  applyModelDefaults,
  applySessionDefaults,
} from "./defaults.js";
import { resolveConfigEnvVars } from "./env-substitution.js";
import { collectConfigEnvVars } from "./env-vars.js";
import { ConfigIncludeError, resolveConfigIncludesDetailed } from "./includes.js";
import { normalizeConfigPaths } from "./normalize-paths.js";
import { resolveConfigPath, resolveDefaultConfigCandidates, resolveStateDir } from "./paths.js";
import { applyConfigOverrides } from "./runtime-overrides.js";
import { validateConfigObject } from "./validation.base.js";
import { compareOpenClawVersions } from "./version.js";

const SHELL_ENV_EXPECTED_KEYS = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_OAUTH_TOKEN",
  "GEMINI_API_KEY",
  "ZAI_API_KEY",
  "OPENROUTER_API_KEY",
  "AI_GATEWAY_API_KEY",
  "MINIMAX_API_KEY",
  "SYNTHETIC_API_KEY",
  "ELEVENLABS_API_KEY",
  "TELEGRAM_BOT_TOKEN",
  "DISCORD_BOT_TOKEN",
  "SLACK_BOT_TOKEN",
  "SLACK_APP_TOKEN",
  "OPENCLAW_GATEWAY_TOKEN",
  "OPENCLAW_GATEWAY_PASSWORD",
];

const DEFAULT_CONFIG_CACHE_MS = 200;
const loggedInvalidBootstrapConfigs = new Set<string>();

export type BootstrapConfigDeps = {
  fs?: typeof fs;
  json5?: typeof JSON5;
  env?: NodeJS.ProcessEnv;
  homedir?: () => string;
  configPath?: string;
  logger?: Pick<typeof console, "error" | "warn">;
};

function resolveConfigPathForDeps(deps: Required<BootstrapConfigDeps>): string {
  if (deps.configPath) {
    return deps.configPath;
  }
  return resolveConfigPath(deps.env, resolveStateDir(deps.env, deps.homedir));
}

function normalizeDeps(overrides: BootstrapConfigDeps = {}): Required<BootstrapConfigDeps> {
  return {
    fs: overrides.fs ?? fs,
    json5: overrides.json5 ?? JSON5,
    env: overrides.env ?? process.env,
    homedir:
      overrides.homedir ?? (() => resolveRequiredHomeDir(overrides.env ?? process.env, os.homedir)),
    configPath: overrides.configPath ?? "",
    logger: overrides.logger ?? console,
  };
}

function applyConfigEnv(cfg: OpenClawConfig, env: NodeJS.ProcessEnv): void {
  const entries = collectConfigEnvVars(cfg);
  for (const [key, value] of Object.entries(entries)) {
    if (env[key]?.trim()) {
      continue;
    }
    env[key] = value;
  }
}

function warnOnConfigMiskeys(raw: unknown, logger: Pick<typeof console, "warn">): void {
  if (!raw || typeof raw !== "object") {
    return;
  }
  const gateway = (raw as Record<string, unknown>).gateway;
  if (!gateway || typeof gateway !== "object") {
    return;
  }
  if ("token" in (gateway as Record<string, unknown>)) {
    logger.warn(
      'Config uses "gateway.token". This key is ignored; use "gateway.auth.token" instead.',
    );
  }
}

function warnIfConfigFromFuture(cfg: OpenClawConfig, logger: Pick<typeof console, "warn">): void {
  const touched = cfg.meta?.lastTouchedVersion;
  if (!touched) {
    return;
  }
  const cmp = compareOpenClawVersions(VERSION, touched);
  if (cmp === null) {
    return;
  }
  if (cmp < 0) {
    logger.warn(
      `Config was last written by a newer OpenClaw (${touched}); current version is ${VERSION}.`,
    );
  }
}

function cloneConfigValue<T>(value: T): T {
  return structuredClone(value);
}

function isWithinDirectory(rootDir: string, targetPath: string): boolean {
  const relative = path.relative(path.resolve(rootDir), path.resolve(targetPath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function applyBootstrapDefaults(cfg: OpenClawConfig): OpenClawConfig {
  return applyModelDefaults(
    applyCompactionDefaults(
      applyContextPruningDefaults(
        applyAgentDefaults(applySessionDefaults(applyLoggingDefaults(applyMessageDefaults(cfg)))),
      ),
    ),
  );
}

function resolveConfigCacheMs(env: NodeJS.ProcessEnv): number {
  const raw = env.OPENCLAW_CONFIG_CACHE_MS?.trim();
  if (raw === "" || raw === "0") {
    return 0;
  }
  if (!raw) {
    return DEFAULT_CONFIG_CACHE_MS;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_CONFIG_CACHE_MS;
  }
  return Math.max(0, parsed);
}

function shouldUseConfigCache(env: NodeJS.ProcessEnv): boolean {
  if (env.OPENCLAW_DISABLE_CONFIG_CACHE?.trim()) {
    return false;
  }
  return resolveConfigCacheMs(env) > 0;
}

let bootstrapConfigCache: {
  configPath: string;
  expiresAt: number;
  config: OpenClawConfig;
} | null = null;

export function clearBootstrapConfigCache(): void {
  bootstrapConfigCache = null;
}

export function createBootstrapConfigIO(overrides: BootstrapConfigDeps = {}) {
  const deps = normalizeDeps(overrides);
  const requestedConfigPath = resolveConfigPathForDeps(deps);
  const candidatePaths = deps.configPath
    ? [requestedConfigPath]
    : resolveDefaultConfigCandidates(deps.env, deps.homedir);
  const configPath =
    candidatePaths.find((candidate) => deps.fs.existsSync(candidate)) ?? requestedConfigPath;
  const includeRoot = path.dirname(configPath);

  function loadConfig(): OpenClawConfig {
    try {
      if (!deps.fs.existsSync(configPath)) {
        if (shouldEnableShellEnvFallback(deps.env) && !shouldDeferShellEnvFallback(deps.env)) {
          loadShellEnvFallback({
            enabled: true,
            env: deps.env,
            expectedKeys: SHELL_ENV_EXPECTED_KEYS,
            logger: deps.logger,
            timeoutMs: resolveShellEnvFallbackTimeoutMs(deps.env),
          });
        }
        return {};
      }

      const raw = deps.fs.readFileSync(configPath, "utf-8");
      const parsed = deps.json5.parse(stripUtf8Bom(raw));
      const includeResolution = resolveConfigIncludesDetailed(parsed, configPath, {
        readFile: (filePath) => {
          if (!isWithinDirectory(includeRoot, filePath)) {
            throw new ConfigIncludeError(
              `Bootstrap config may only include files within ${includeRoot}`,
              filePath,
            );
          }
          return deps.fs.readFileSync(filePath, "utf-8");
        },
        parseJson: (value) => deps.json5.parse(stripUtf8Bom(value)),
      });
      const resolved = includeResolution.value;

      if (resolved && typeof resolved === "object" && "env" in resolved) {
        applyConfigEnv(resolved as OpenClawConfig, deps.env);
      }

      const substituted = resolveConfigEnvVars(resolved, deps.env);
      warnOnConfigMiskeys(substituted, deps.logger);
      if (typeof substituted !== "object" || substituted === null) {
        return {};
      }

      const validated = validateConfigObject(substituted);
      if (!validated.ok) {
        const details = validated.issues
          .map((issue) => `- ${issue.path || "<root>"}: ${issue.message}`)
          .join("\n");
        if (!loggedInvalidBootstrapConfigs.has(configPath)) {
          loggedInvalidBootstrapConfigs.add(configPath);
          deps.logger.error(`Invalid bootstrap config at ${configPath}:\n${details}`);
        }
        return {};
      }

      warnIfConfigFromFuture(validated.config, deps.logger);
      const cfg = applyBootstrapDefaults(validated.config);
      normalizeConfigPaths(cfg);
      applyConfigEnv(cfg, deps.env);

      const enabled = shouldEnableShellEnvFallback(deps.env) || cfg.env?.shellEnv?.enabled === true;
      if (enabled && !shouldDeferShellEnvFallback(deps.env)) {
        loadShellEnvFallback({
          enabled: true,
          env: deps.env,
          expectedKeys: SHELL_ENV_EXPECTED_KEYS,
          logger: deps.logger,
          timeoutMs: cfg.env?.shellEnv?.timeoutMs ?? resolveShellEnvFallbackTimeoutMs(deps.env),
        });
      }

      return applyConfigOverrides(cfg);
    } catch (err) {
      const message =
        err instanceof ConfigIncludeError
          ? err.message
          : `Failed to read bootstrap config at ${configPath}: ${String(err)}`;
      deps.logger.error(message);
      return {};
    }
  }

  return {
    configPath,
    loadConfig,
  };
}

export function loadBootstrapConfig(): OpenClawConfig {
  const io = createBootstrapConfigIO();
  const configPath = io.configPath;
  const now = Date.now();
  if (shouldUseConfigCache(process.env)) {
    const cached = bootstrapConfigCache;
    if (cached && cached.configPath === configPath && cached.expiresAt > now) {
      return cloneConfigValue(cached.config);
    }
  }

  const config = io.loadConfig();
  if (shouldUseConfigCache(process.env)) {
    const cacheMs = resolveConfigCacheMs(process.env);
    if (cacheMs > 0) {
      bootstrapConfigCache = {
        configPath,
        expiresAt: now + cacheMs,
        config: cloneConfigValue(config),
      };
    }
  }
  return config;
}
