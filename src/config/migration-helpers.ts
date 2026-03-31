import { isDeepStrictEqual } from "node:util";
import {
  getConfigValueAtPath,
  hasConfigValueAtPath,
  setConfigValueAtPath,
  unsetConfigValueAtPath,
} from "./config-paths.js";

export type ConfigMigrationStatus = "applied" | "skipped" | "error";

export type ConfigMigrationEvent = {
  migrationId: string;
  status: ConfigMigrationStatus;
  reason: string;
  sourceScope: "config";
  destinationScope: "config";
  sourcePaths: string[];
  destinationPaths: string[];
};

export type ConfigMigrationRecorder = {
  recordApplied: (params: {
    reason: string;
    sourcePath?: string;
    destinationPath?: string;
  }) => void;
  recordSkipped: (params: {
    reason: string;
    sourcePath?: string;
    destinationPath?: string;
  }) => void;
  recordError: (params: {
    reason: string;
    sourcePath?: string;
    destinationPath?: string;
  }) => void;
  finalize: (params: {
    changed: boolean;
    defaultAppliedReason: string;
    defaultSkippedReason: string;
  }) => ConfigMigrationEvent;
};

export type ConfigMigrationOperationResult = {
  status: "applied" | "skipped";
  reason: string;
  sourcePath?: string;
  destinationPath?: string;
};

type TransformResult =
  | {
      ok: true;
      value: unknown;
      reason?: string;
    }
  | {
      ok: false;
      reason: string;
    };

function isIndexSegment(raw: string): boolean {
  return /^[0-9]+$/.test(raw);
}

export function formatConfigPath(path: string[]): string {
  return path.reduce((acc, segment, index) => {
    if (isIndexSegment(segment)) {
      return `${acc}[${segment}]`;
    }
    if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(segment)) {
      return index === 0 ? segment : `${acc}.${segment}`;
    }
    return `${acc}[${JSON.stringify(segment)}]`;
  }, "");
}

export function createConfigMigrationRecorder(migrationId: string): ConfigMigrationRecorder {
  const appliedReasons = new Set<string>();
  const skippedReasons = new Set<string>();
  const errorReasons = new Set<string>();
  const sourcePaths = new Set<string>();
  const destinationPaths = new Set<string>();
  let applied = false;
  let failed = false;

  const rememberPaths = (sourcePath?: string, destinationPath?: string) => {
    if (sourcePath) {
      sourcePaths.add(sourcePath);
    }
    if (destinationPath) {
      destinationPaths.add(destinationPath);
    }
  };

  return {
    recordApplied: ({ reason, sourcePath, destinationPath }) => {
      applied = true;
      appliedReasons.add(reason);
      rememberPaths(sourcePath, destinationPath);
    },
    recordSkipped: ({ reason, sourcePath, destinationPath }) => {
      skippedReasons.add(reason);
      rememberPaths(sourcePath, destinationPath);
    },
    recordError: ({ reason, sourcePath, destinationPath }) => {
      failed = true;
      errorReasons.add(reason);
      rememberPaths(sourcePath, destinationPath);
    },
    finalize: ({ changed, defaultAppliedReason, defaultSkippedReason }) => {
      const status: ConfigMigrationStatus = failed ? "error" : applied || changed ? "applied" : "skipped";
      const reason =
        status === "error"
          ? [...errorReasons][0] ?? "migration failed"
          : status === "applied"
            ? [...appliedReasons][0] ?? defaultAppliedReason
            : [...skippedReasons][0] ?? defaultSkippedReason;
      return {
        migrationId,
        status,
        reason,
        sourceScope: "config",
        destinationScope: "config",
        sourcePaths: [...sourcePaths],
        destinationPaths: [...destinationPaths],
      };
    },
  };
}

export function recordConfigMigrationOperation(
  recorder: ConfigMigrationRecorder | undefined,
  result: ConfigMigrationOperationResult,
): void {
  if (!recorder) {
    return;
  }
  if (result.status === "applied") {
    recorder.recordApplied(result);
    return;
  }
  recorder.recordSkipped(result);
}

function runTransform(value: unknown, transform?: (value: unknown) => TransformResult): TransformResult {
  if (!transform) {
    return { ok: true, value };
  }
  return transform(value);
}

export function moveConfigValue(params: {
  root: Record<string, unknown>;
  fromPath: string[];
  toPath: string[];
  transform?: (value: unknown) => TransformResult;
}): ConfigMigrationOperationResult {
  const sourcePath = formatConfigPath(params.fromPath);
  const destinationPath = formatConfigPath(params.toPath);

  if (sourcePath === destinationPath) {
    return {
      status: "skipped",
      reason: "source and destination paths are identical",
      sourcePath,
      destinationPath,
    };
  }

  if (!hasConfigValueAtPath(params.root, params.fromPath)) {
    return {
      status: "skipped",
      reason: "source value missing",
      sourcePath,
      destinationPath,
    };
  }

  if (hasConfigValueAtPath(params.root, params.toPath)) {
    unsetConfigValueAtPath(params.root, params.fromPath);
    return {
      status: "applied",
      reason: "destination already set; removed legacy source",
      sourcePath,
      destinationPath,
    };
  }

  const sourceValue = getConfigValueAtPath(params.root, params.fromPath);
  const transformed = runTransform(sourceValue, params.transform);
  if (!transformed.ok) {
    return {
      status: "skipped",
      reason: transformed.reason,
      sourcePath,
      destinationPath,
    };
  }

  setConfigValueAtPath(params.root, params.toPath, transformed.value);
  unsetConfigValueAtPath(params.root, params.fromPath);
  return {
    status: "applied",
    reason: transformed.reason ?? "moved value to destination",
    sourcePath,
    destinationPath,
  };
}

export function renameConfigValue(params: {
  root: Record<string, unknown>;
  fromPath: string[];
  toPath: string[];
}): ConfigMigrationOperationResult {
  return moveConfigValue(params);
}

export function remapConfigValue(params: {
  root: Record<string, unknown>;
  path: string[];
  remap:
    | Map<string, unknown>
    | Record<string, unknown>
    | ((value: unknown) => TransformResult);
}): ConfigMigrationOperationResult {
  const targetPath = formatConfigPath(params.path);
  if (!hasConfigValueAtPath(params.root, params.path)) {
    return {
      status: "skipped",
      reason: "source value missing",
      sourcePath: targetPath,
      destinationPath: targetPath,
    };
  }

  const current = getConfigValueAtPath(params.root, params.path);
  let mapped: TransformResult;
  if (typeof params.remap === "function") {
    mapped = params.remap(current);
  } else if (params.remap instanceof Map) {
    if (typeof current !== "string" || !params.remap.has(current)) {
      mapped = { ok: false, reason: "value does not match a legacy alias" };
    } else {
      mapped = { ok: true, value: params.remap.get(current), reason: "remapped legacy alias" };
    }
  } else if (typeof current === "string" && current in params.remap) {
    mapped = {
      ok: true,
      value: params.remap[current],
      reason: "remapped legacy alias",
    };
  } else {
    mapped = { ok: false, reason: "value does not match a legacy alias" };
  }

  if (!mapped.ok) {
    return {
      status: "skipped",
      reason: mapped.reason,
      sourcePath: targetPath,
      destinationPath: targetPath,
    };
  }
  if (isDeepStrictEqual(current, mapped.value)) {
    return {
      status: "skipped",
      reason: "value already canonical",
      sourcePath: targetPath,
      destinationPath: targetPath,
    };
  }

  setConfigValueAtPath(params.root, params.path, mapped.value);
  return {
    status: "applied",
    reason: mapped.reason ?? "remapped stored value",
    sourcePath: targetPath,
    destinationPath: targetPath,
  };
}

export function mergeUniqueStringArrays(params: {
  root: Record<string, unknown>;
  fromPath: string[];
  toPath: string[];
}): ConfigMigrationOperationResult {
  const sourcePath = formatConfigPath(params.fromPath);
  const destinationPath = formatConfigPath(params.toPath);

  if (sourcePath === destinationPath) {
    return {
      status: "skipped",
      reason: "source and destination paths are identical",
      sourcePath,
      destinationPath,
    };
  }

  if (!hasConfigValueAtPath(params.root, params.fromPath)) {
    return {
      status: "skipped",
      reason: "source value missing",
      sourcePath,
      destinationPath,
    };
  }

  const sourceRaw = getConfigValueAtPath(params.root, params.fromPath);
  if (!Array.isArray(sourceRaw) || sourceRaw.some((value) => typeof value !== "string")) {
    return {
      status: "skipped",
      reason: "source value is not a string array",
      sourcePath,
      destinationPath,
    };
  }

  const destinationExists = hasConfigValueAtPath(params.root, params.toPath);
  const destinationRaw = getConfigValueAtPath(params.root, params.toPath);
  if (
    destinationExists &&
    (!Array.isArray(destinationRaw) || destinationRaw.some((value) => typeof value !== "string"))
  ) {
    return {
      status: "skipped",
      reason: "destination value is not a string array",
      sourcePath,
      destinationPath,
    };
  }

  const destination = Array.isArray(destinationRaw) ? [...destinationRaw] : [];
  let appended = false;
  for (const value of sourceRaw) {
    if (destination.includes(value)) {
      continue;
    }
    destination.push(value);
    appended = true;
  }

  if (appended || !destinationExists) {
    setConfigValueAtPath(params.root, params.toPath, destination);
  }
  unsetConfigValueAtPath(params.root, params.fromPath);
  return {
    status: "applied",
    reason: appended ? "merged unique string array values" : "destination already covered source values; removed legacy source",
    sourcePath,
    destinationPath,
  };
}

export function clearExplicitValueIfEqualsDefault(params: {
  root: Record<string, unknown>;
  path: string[];
  resolvedDefault: unknown;
}): ConfigMigrationOperationResult {
  const targetPath = formatConfigPath(params.path);
  if (!hasConfigValueAtPath(params.root, params.path)) {
    return {
      status: "skipped",
      reason: "source value missing",
      sourcePath: targetPath,
      destinationPath: targetPath,
    };
  }

  const current = getConfigValueAtPath(params.root, params.path);
  if (!isDeepStrictEqual(current, params.resolvedDefault)) {
    return {
      status: "skipped",
      reason: "stored value differs from default",
      sourcePath: targetPath,
      destinationPath: targetPath,
    };
  }

  unsetConfigValueAtPath(params.root, params.path);
  return {
    status: "applied",
    reason: "stored value matched the default; cleared explicit value",
    sourcePath: targetPath,
    destinationPath: targetPath,
  };
}
