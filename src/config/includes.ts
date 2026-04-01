/**
 * Config includes: $include directive for modular configs
 *
 * @example
 * ```json5
 * {
 *   "$include": "./base.json5",           // single file
 *   "$include": ["./a.json5", "./b.json5"] // merge multiple
 * }
 * ```
 */

import JSON5 from "json5";
import fs from "node:fs";
import path from "node:path";
import {
  getConfigIssueDocLink,
  getConfigIssueSuggestion,
  isRootOnlyConfigPath,
} from "./trust-boundaries.js";

export const INCLUDE_KEY = "$include";
export const MAX_INCLUDE_DEPTH = 10;

// ============================================================================
// Types
// ============================================================================

export type IncludeResolver = {
  readFile: (path: string) => string;
  parseJson: (raw: string) => unknown;
};

export type IncludeResolutionWarning = {
  file: string;
  path: string;
  message: string;
  suggestion?: string;
  docLink?: string;
};

export type ConfigIncludeResolution = {
  value: unknown;
  warnings: IncludeResolutionWarning[];
};

// ============================================================================
// Errors
// ============================================================================

export class ConfigIncludeError extends Error {
  constructor(
    message: string,
    public readonly includePath: string,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = "ConfigIncludeError";
  }
}

export class CircularIncludeError extends ConfigIncludeError {
  constructor(public readonly chain: string[]) {
    super(`Circular include detected: ${chain.join(" -> ")}`, chain[chain.length - 1]);
    this.name = "CircularIncludeError";
  }
}

// ============================================================================
// Utilities
// ============================================================================

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.prototype.toString.call(value) === "[object Object]"
  );
}

function formatPath(pathSegments: string[]): string {
  return pathSegments.join(".");
}

function sanitizeIncludedValue(params: {
  value: unknown;
  pathSegments: string[];
  sourcePath: string;
  warnings: IncludeResolutionWarning[];
}): unknown {
  if (Array.isArray(params.value)) {
    return params.value.map((entry, index) =>
      sanitizeIncludedValue({
        ...params,
        value: entry,
        pathSegments: [...params.pathSegments, String(index)],
      }),
    );
  }

  if (!isPlainObject(params.value)) {
    return params.value;
  }

  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(params.value)) {
    const childPath = [...params.pathSegments, key];
    const childPathRaw = formatPath(childPath);
    if (isRootOnlyConfigPath(childPathRaw)) {
      const message =
        "ignored because this safety-sensitive setting must be defined in the main config file";
      params.warnings.push({
        file: params.sourcePath,
        path: childPathRaw,
        message,
        suggestion: getConfigIssueSuggestion({
          path: childPathRaw,
          message,
          rootOnly: true,
        }),
        docLink: getConfigIssueDocLink(childPathRaw),
      });
      continue;
    }
    result[key] = sanitizeIncludedValue({
      ...params,
      value: child,
      pathSegments: childPath,
    });
  }
  return result;
}

/** Deep merge: arrays concatenate, objects merge recursively, primitives: source wins */
export function deepMerge(target: unknown, source: unknown): unknown {
  if (Array.isArray(target) && Array.isArray(source)) {
    return [...target, ...source];
  }
  if (isPlainObject(target) && isPlainObject(source)) {
    const result: Record<string, unknown> = { ...target };
    for (const key of Object.keys(source)) {
      result[key] = key in result ? deepMerge(result[key], source[key]) : source[key];
    }
    return result;
  }
  return source;
}

// ============================================================================
// Include Resolver Class
// ============================================================================

class IncludeProcessor {
  private visited = new Set<string>();
  private depth = 0;

  constructor(
    private basePath: string,
    private resolver: IncludeResolver,
    private warnings: IncludeResolutionWarning[] = [],
  ) {
    this.visited.add(path.normalize(basePath));
  }

  process(obj: unknown, pathSegments: string[] = []): unknown {
    if (Array.isArray(obj)) {
      return obj.map((item, index) => this.process(item, [...pathSegments, String(index)]));
    }

    if (!isPlainObject(obj)) {
      return obj;
    }

    if (!(INCLUDE_KEY in obj)) {
      return this.processObject(obj, pathSegments);
    }

    return this.processInclude(obj, pathSegments);
  }

  private processObject(
    obj: Record<string, unknown>,
    pathSegments: string[],
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = this.process(value, [...pathSegments, key]);
    }
    return result;
  }

  private processInclude(obj: Record<string, unknown>, pathSegments: string[]): unknown {
    const includeValue = obj[INCLUDE_KEY];
    const otherKeys = Object.keys(obj).filter((k) => k !== INCLUDE_KEY);
    const included = this.resolveInclude(includeValue, pathSegments);

    if (otherKeys.length === 0) {
      return included;
    }

    if (!isPlainObject(included)) {
      throw new ConfigIncludeError(
        "Sibling keys require included content to be an object",
        typeof includeValue === "string" ? includeValue : INCLUDE_KEY,
      );
    }

    // Merge included content with sibling keys
    const rest: Record<string, unknown> = {};
    for (const key of otherKeys) {
      rest[key] = this.process(obj[key], [...pathSegments, key]);
    }
    return deepMerge(included, rest);
  }

  private resolveInclude(value: unknown, pathSegments: string[]): unknown {
    if (typeof value === "string") {
      return this.loadFile(value, pathSegments);
    }

    if (Array.isArray(value)) {
      return value.reduce<unknown>((merged, item) => {
        if (typeof item !== "string") {
          throw new ConfigIncludeError(
            `Invalid $include array item: expected string, got ${typeof item}`,
            String(item),
          );
        }
        return deepMerge(merged, this.loadFile(item, pathSegments));
      }, {});
    }

    throw new ConfigIncludeError(
      `Invalid $include value: expected string or array of strings, got ${typeof value}`,
      String(value),
    );
  }

  private loadFile(includePath: string, pathSegments: string[]): unknown {
    const resolvedPath = this.resolvePath(includePath);

    this.checkCircular(resolvedPath);
    this.checkDepth(includePath);

    const raw = this.readFile(includePath, resolvedPath);
    const parsed = this.parseFile(includePath, resolvedPath, raw);

    return sanitizeIncludedValue({
      value: this.processNested(resolvedPath, parsed, pathSegments),
      pathSegments,
      sourcePath: resolvedPath,
      warnings: this.warnings,
    });
  }

  private resolvePath(includePath: string): string {
    const resolved = path.isAbsolute(includePath)
      ? includePath
      : path.resolve(path.dirname(this.basePath), includePath);
    return path.normalize(resolved);
  }

  private checkCircular(resolvedPath: string): void {
    if (this.visited.has(resolvedPath)) {
      throw new CircularIncludeError([...this.visited, resolvedPath]);
    }
  }

  private checkDepth(includePath: string): void {
    if (this.depth >= MAX_INCLUDE_DEPTH) {
      throw new ConfigIncludeError(
        `Maximum include depth (${MAX_INCLUDE_DEPTH}) exceeded at: ${includePath}`,
        includePath,
      );
    }
  }

  private readFile(includePath: string, resolvedPath: string): string {
    try {
      return this.resolver.readFile(resolvedPath);
    } catch (err) {
      throw new ConfigIncludeError(
        `Failed to read include file: ${includePath} (resolved: ${resolvedPath})`,
        includePath,
        err instanceof Error ? err : undefined,
      );
    }
  }

  private parseFile(includePath: string, resolvedPath: string, raw: string): unknown {
    try {
      return this.resolver.parseJson(raw);
    } catch (err) {
      throw new ConfigIncludeError(
        `Failed to parse include file: ${includePath} (resolved: ${resolvedPath})`,
        includePath,
        err instanceof Error ? err : undefined,
      );
    }
  }

  private processNested(resolvedPath: string, parsed: unknown, pathSegments: string[]): unknown {
    const nested = new IncludeProcessor(resolvedPath, this.resolver, this.warnings);
    nested.visited = new Set([...this.visited, resolvedPath]);
    nested.depth = this.depth + 1;
    return nested.process(parsed, pathSegments);
  }
}

// ============================================================================
// Public API
// ============================================================================

const defaultResolver: IncludeResolver = {
  readFile: (p) => fs.readFileSync(p, "utf-8"),
  parseJson: (raw) => JSON5.parse(raw),
};

/**
 * Resolves all $include directives in a parsed config object.
 */
export function resolveConfigIncludes(
  obj: unknown,
  configPath: string,
  resolver: IncludeResolver = defaultResolver,
): unknown {
  return resolveConfigIncludesDetailed(obj, configPath, resolver).value;
}

export function resolveConfigIncludesDetailed(
  obj: unknown,
  configPath: string,
  resolver: IncludeResolver = defaultResolver,
): ConfigIncludeResolution {
  const warnings: IncludeResolutionWarning[] = [];
  return {
    value: new IncludeProcessor(configPath, resolver, warnings).process(obj),
    warnings,
  };
}
