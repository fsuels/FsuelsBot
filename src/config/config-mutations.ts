import {
  getConfigValueAtPath,
  hasConfigValueAtPath,
  parseConfigPath,
  setConfigValueAtPath,
  unsetConfigValueAtPath,
} from "./config-paths.js";
import {
  readConfigFileSnapshot,
  validateConfigObjectWithPlugins,
  writeConfigFile,
} from "./config.js";
import { redactConfigObject, redactConfigSnapshot } from "./redact-snapshot.js";

export type ConfigPathReadResult =
  | {
      ok: true;
      path: string[];
      storedExists: boolean;
      storedValue: unknown;
      effectiveExists: boolean;
      effectiveValue: unknown;
    }
  | {
      ok: false;
      errorCode: "INVALID_CONFIG" | "INVALID_PATH";
      errorMessage: string;
    };

export type ConfigPathMutationResult =
  | {
      ok: true;
      operation: "set" | "unset";
      path: string[];
      previousExists: boolean;
      previousValue: unknown;
      newExists: boolean;
      newValue: unknown;
      effectiveExists: boolean;
      effectiveValue: unknown;
    }
  | {
      ok: false;
      operation: "set" | "unset";
      errorCode:
        | "INVALID_CONFIG"
        | "INVALID_PATH"
        | "NOT_FOUND"
        | "VALIDATION_FAILED"
        | "WRITE_FAILED";
      errorMessage: string;
    };

function snapshotRoot(parsed: unknown): Record<string, unknown> {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }
  return parsed as Record<string, unknown>;
}

export async function readConfigPathValues(params: {
  pathRaw: string;
  effectiveConfig?: unknown;
}): Promise<ConfigPathReadResult> {
  const snapshot = await readConfigFileSnapshot();
  if (!snapshot.valid) {
    return {
      ok: false,
      errorCode: "INVALID_CONFIG",
      errorMessage: "Config file is invalid; fix it before using /config.",
    };
  }

  const parsedPath = parseConfigPath(params.pathRaw);
  if (!parsedPath.ok || !parsedPath.path) {
    return {
      ok: false,
      errorCode: "INVALID_PATH",
      errorMessage: parsedPath.error ?? "Invalid path.",
    };
  }

  const redactedSnapshot = redactConfigSnapshot(snapshot);
  const storedRoot = snapshotRoot(redactedSnapshot.parsed);
  const effectiveRoot = snapshotRoot(
    params.effectiveConfig === undefined
      ? redactConfigObject(snapshot.config)
      : redactConfigObject(params.effectiveConfig),
  );

  return {
    ok: true,
    path: parsedPath.path,
    storedExists: hasConfigValueAtPath(storedRoot, parsedPath.path),
    storedValue: getConfigValueAtPath(storedRoot, parsedPath.path),
    effectiveExists: hasConfigValueAtPath(effectiveRoot, parsedPath.path),
    effectiveValue: getConfigValueAtPath(effectiveRoot, parsedPath.path),
  };
}

export async function mutateConfigAtPath(params: {
  operation: "set" | "unset";
  pathRaw: string;
  value?: unknown;
}): Promise<ConfigPathMutationResult> {
  const snapshot = await readConfigFileSnapshot();
  if (!snapshot.valid) {
    return {
      ok: false,
      operation: params.operation,
      errorCode: "INVALID_CONFIG",
      errorMessage: "Config file is invalid; fix it before using /config.",
    };
  }

  const parsedPath = parseConfigPath(params.pathRaw);
  if (!parsedPath.ok || !parsedPath.path) {
    return {
      ok: false,
      operation: params.operation,
      errorCode: "INVALID_PATH",
      errorMessage: parsedPath.error ?? "Invalid path.",
    };
  }

  const nextRoot = structuredClone(snapshotRoot(snapshot.parsed));
  const previousExists = hasConfigValueAtPath(nextRoot, parsedPath.path);
  const previousValue = getConfigValueAtPath(nextRoot, parsedPath.path);

  if (params.operation === "unset") {
    const removed = unsetConfigValueAtPath(nextRoot, parsedPath.path);
    if (!removed) {
      return {
        ok: false,
        operation: params.operation,
        errorCode: "NOT_FOUND",
        errorMessage: `No config value found for ${params.pathRaw}.`,
      };
    }
  } else {
    setConfigValueAtPath(nextRoot, parsedPath.path, params.value);
  }

  const validated = validateConfigObjectWithPlugins(nextRoot);
  if (!validated.ok) {
    const issue = validated.issues[0];
    return {
      ok: false,
      operation: params.operation,
      errorCode: "VALIDATION_FAILED",
      errorMessage: `Config invalid after ${params.operation} (${issue.path}: ${issue.message}).`,
    };
  }

  try {
    await writeConfigFile(validated.config);
  } catch (err) {
    return {
      ok: false,
      operation: params.operation,
      errorCode: "WRITE_FAILED",
      errorMessage: `Config write failed: ${String(err instanceof Error ? err.message : err)}`,
    };
  }

  return {
    ok: true,
    operation: params.operation,
    path: parsedPath.path,
    previousExists,
    previousValue,
    newExists: hasConfigValueAtPath(validated.config as Record<string, unknown>, parsedPath.path),
    newValue: getConfigValueAtPath(validated.config as Record<string, unknown>, parsedPath.path),
    effectiveExists: hasConfigValueAtPath(
      validated.config as Record<string, unknown>,
      parsedPath.path,
    ),
    effectiveValue: getConfigValueAtPath(
      validated.config as Record<string, unknown>,
      parsedPath.path,
    ),
  };
}
