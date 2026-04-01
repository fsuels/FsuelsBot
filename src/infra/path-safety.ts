import os from "node:os";
import path from "node:path";

const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;

function normalizeUnicodeSpaces(value: string): string {
  return value.replace(UNICODE_SPACES, " ");
}

function convertMingwPath(value: string, platform: NodeJS.Platform): string {
  if (platform !== "win32") {
    return value;
  }
  const match = /^\/([a-zA-Z])(?:\/|$)/.exec(value);
  if (!match) {
    return value;
  }
  const drive = `${match[1].toUpperCase()}:`;
  const remainder = value.slice(match[0].length).replace(/\//g, "\\");
  return remainder ? `${drive}\\${remainder}` : `${drive}\\`;
}

function normalizeResolvedPath(value: string, platform: NodeJS.Platform): string {
  return platform === "win32" ? path.win32.normalize(value) : path.normalize(value);
}

function isAbsolutePath(value: string, platform: NodeJS.Platform): boolean {
  return platform === "win32" ? path.win32.isAbsolute(value) : path.isAbsolute(value);
}

export function assertNoNullBytes(value: string): void {
  if (value.includes("\0")) {
    throw new Error("Path contains a null byte.");
  }
}

export function isWindowsUncPath(value: string): boolean {
  return (
    /^\\\\[^\\/?*<>|]+[\\/][^\\/?*<>|]+/.test(value) || /^\/\/[^/?*<>|]+\/[^/?*<>|]+/.test(value)
  );
}

export function containsPathTraversal(value: string): boolean {
  assertNoNullBytes(value);
  return normalizeUnicodeSpaces(value)
    .replace(/\\/g, "/")
    .split("/")
    .some((segment) => segment === "..");
}

export function expandPath(
  value: string,
  options?: {
    homeDir?: string;
    platform?: NodeJS.Platform;
    stripAtPrefix?: boolean;
  },
): string {
  assertNoNullBytes(value);
  const homeDir = options?.homeDir ?? os.homedir();
  const platform = options?.platform ?? process.platform;
  const trimmed = normalizeUnicodeSpaces(value.trim());
  const stripped = options?.stripAtPrefix && trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
  const mingwExpanded = convertMingwPath(stripped, platform);
  if (mingwExpanded === "~") {
    return homeDir;
  }
  if (mingwExpanded.startsWith("~/") || mingwExpanded.startsWith("~\\")) {
    return path.join(homeDir, mingwExpanded.slice(2));
  }
  return mingwExpanded;
}

export function resolvePathAgainstBase(
  value: string,
  baseDir: string,
  options?: {
    homeDir?: string;
    platform?: NodeJS.Platform;
    stripAtPrefix?: boolean;
  },
): string {
  const platform = options?.platform ?? process.platform;
  const expanded = expandPath(value, options);
  if (isAbsolutePath(expanded, platform)) {
    return normalizeResolvedPath(expanded, platform);
  }
  const normalizedBase = normalizeResolvedPath(baseDir, platform);
  return normalizeResolvedPath(
    platform === "win32"
      ? path.win32.resolve(normalizedBase, expanded)
      : path.resolve(normalizedBase, expanded),
    platform,
  );
}

export function normalizePathForConfigKey(
  value: string,
  options?: {
    platform?: NodeJS.Platform;
  },
): string {
  const platform = options?.platform ?? process.platform;
  const normalized = normalizeResolvedPath(expandPath(value, { platform }), platform).replace(
    /\\/g,
    "/",
  );
  const trimmed =
    normalized.length > 1 && normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
  return platform === "win32"
    ? trimmed.replace(/^([A-Z]):/, (_, drive) => `${drive.toLowerCase()}:`)
    : trimmed;
}
