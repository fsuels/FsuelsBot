import type { OpenClawConfig } from "./types.openclaw.js";

export const SAFE_ENV_VARS = [
  "COLORTERM",
  "FORCE_COLOR",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "NO_COLOR",
  "TERM",
  "TZ",
] as const;

const SAFE_ENV_VAR_SET = new Set<string>(SAFE_ENV_VARS);

export type DangerousSettingsSubset = {
  dangerousShellSettings: string[];
  dangerousEnvVars: string[];
  hooksPresent: boolean;
  hookPaths: string[];
};

function normalizeNames(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort(
    (left, right) => left.localeCompare(right),
  );
}

function collectEnvVarKeys(env: OpenClawConfig["env"]): string[] {
  if (!env || typeof env !== "object") {
    return [];
  }
  const names = new Set<string>();
  const vars = env.vars;
  if (vars && typeof vars === "object") {
    Object.keys(vars).forEach((key) => {
      if (!SAFE_ENV_VAR_SET.has(key)) {
        names.add(key);
      }
    });
  }
  Object.entries(env).forEach(([key, value]) => {
    if (key === "vars" || key === "shellEnv") {
      return;
    }
    if (typeof value === "string" && !SAFE_ENV_VAR_SET.has(key)) {
      names.add(key);
    }
  });
  return normalizeNames([...names]);
}

function collectDefinedPaths(value: unknown, basePath: string, out: string[]) {
  if (value === undefined) {
    return;
  }
  if (value === null || typeof value !== "object") {
    out.push(basePath);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 0) {
      out.push(basePath);
    }
    return;
  }
  const entries = Object.entries(value).filter(([, child]) => child !== undefined);
  if (entries.length === 0) {
    return;
  }
  entries.forEach(([key, child]) => {
    collectDefinedPaths(child, `${basePath}.${key}`, out);
  });
}

export function extractDangerousSettings(
  settings: Pick<OpenClawConfig, "env" | "hooks"> | undefined,
): DangerousSettingsSubset {
  const dangerousShellSettings =
    settings?.env?.shellEnv?.enabled === true
      ? normalizeNames(
          [
            "env.shellEnv.enabled",
            typeof settings.env.shellEnv.timeoutMs === "number" ? "env.shellEnv.timeoutMs" : "",
          ].filter(Boolean),
        )
      : [];
  const dangerousEnvVars = collectEnvVarKeys(settings?.env);
  const hookPathsRaw: string[] = [];
  collectDefinedPaths(settings?.hooks, "hooks", hookPathsRaw);
  const hookPaths = normalizeNames(hookPathsRaw);
  return {
    dangerousShellSettings,
    dangerousEnvVars,
    hooksPresent: hookPaths.length > 0,
    hookPaths,
  };
}

export function listDangerousSettingNames(subset: DangerousSettingsSubset): string[] {
  return normalizeNames([
    ...subset.dangerousShellSettings,
    ...subset.dangerousEnvVars.map((name) => `env.${name}`),
    ...subset.hookPaths,
  ]);
}

function normalizeDangerousSubsetForJson(subset: DangerousSettingsSubset) {
  return {
    dangerousShellSettings: normalizeNames(subset.dangerousShellSettings),
    dangerousEnvVars: normalizeNames(subset.dangerousEnvVars),
    hooksPresent: subset.hooksPresent,
    hookPaths: normalizeNames(subset.hookPaths),
  };
}

export function hasDangerousSettingsChanged(
  oldSettings: Pick<OpenClawConfig, "env" | "hooks"> | undefined,
  newSettings: Pick<OpenClawConfig, "env" | "hooks"> | undefined,
): boolean {
  const previous = normalizeDangerousSubsetForJson(extractDangerousSettings(oldSettings));
  const next = normalizeDangerousSubsetForJson(extractDangerousSettings(newSettings));
  return JSON.stringify(previous) !== JSON.stringify(next);
}
