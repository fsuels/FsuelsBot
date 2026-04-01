import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { isWindowsUncPath } from "./path-safety.js";

const NOT_FOUND_CODES = new Set(["ENOENT", "ENOTDIR"]);
const BLOCKED_RESOLUTION_CODES = new Set(["EACCES", "EPERM", "ELOOP"]);
const MAX_SYMLINK_DEPTH = 40;

export type SafeResolvedPath = Readonly<{
  absolutePath: string;
  effectivePath: string;
  canonical: boolean;
  symlinkInvolved: boolean;
  checkedPaths: readonly string[];
  resolutionErrorCode?: string;
}>;

function hasErrnoCode(error: unknown, codes: Set<string>): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return typeof code === "string" && codes.has(code);
}

function getErrnoCode(error: unknown): string | undefined {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return typeof code === "string" ? code : undefined;
}

function normalizeAbsolutePath(value: string): string {
  const resolved = path.normalize(path.resolve(value));
  try {
    return resolved.normalize("NFC");
  } catch {
    return resolved;
  }
}

function splitPathSegments(absolutePath: string): {
  root: string;
  segments: string[];
} {
  const normalized = normalizeAbsolutePath(absolutePath);
  const root = path.parse(normalized).root || path.sep;
  const remainder = normalized.slice(root.length);
  return {
    root: path.normalize(root),
    segments: remainder.split(path.sep).filter(Boolean),
  };
}

async function tryRealpath(filePath: string): Promise<{
  effectivePath: string;
  canonical: boolean;
  resolutionErrorCode?: string;
}> {
  try {
    return {
      effectivePath: normalizeAbsolutePath(await fs.realpath(filePath)),
      canonical: true,
    };
  } catch (error) {
    if (hasErrnoCode(error, NOT_FOUND_CODES)) {
      return {
        effectivePath: normalizeAbsolutePath(filePath),
        canonical: false,
      };
    }
    if (hasErrnoCode(error, BLOCKED_RESOLUTION_CODES)) {
      return {
        effectivePath: normalizeAbsolutePath(filePath),
        canonical: false,
        resolutionErrorCode: getErrnoCode(error),
      };
    }
    throw error;
  }
}

function tryRealpathSync(filePath: string): {
  effectivePath: string;
  canonical: boolean;
  resolutionErrorCode?: string;
} {
  try {
    return {
      effectivePath: normalizeAbsolutePath(
        fsSync.realpathSync.native?.(filePath) ?? fsSync.realpathSync(filePath),
      ),
      canonical: true,
    };
  } catch (error) {
    if (hasErrnoCode(error, NOT_FOUND_CODES)) {
      return {
        effectivePath: normalizeAbsolutePath(filePath),
        canonical: false,
      };
    }
    if (hasErrnoCode(error, BLOCKED_RESOLUTION_CODES)) {
      return {
        effectivePath: normalizeAbsolutePath(filePath),
        canonical: false,
        resolutionErrorCode: getErrnoCode(error),
      };
    }
    throw error;
  }
}

async function resolvePathState(
  targetPath: string,
  checkedPaths: Set<string>,
  symlinkDepth: number,
): Promise<{
  effectivePath: string;
  canonical: boolean;
  symlinkInvolved: boolean;
  resolutionErrorCode?: string;
}> {
  const absolutePath = normalizeAbsolutePath(targetPath);
  checkedPaths.add(absolutePath);

  if (process.platform === "win32" && isWindowsUncPath(targetPath)) {
    return {
      effectivePath: absolutePath,
      canonical: false,
      symlinkInvolved: false,
      resolutionErrorCode: "UNC",
    };
  }

  if (symlinkDepth > MAX_SYMLINK_DEPTH) {
    return {
      effectivePath: absolutePath,
      canonical: false,
      symlinkInvolved: true,
      resolutionErrorCode: "ELOOP",
    };
  }

  const { root, segments } = splitPathSegments(absolutePath);
  let current = root;
  let symlinkInvolved = false;

  for (let index = 0; index < segments.length; index += 1) {
    const candidate = normalizeAbsolutePath(path.join(current, segments[index]));
    checkedPaths.add(candidate);

    let stat: fsSync.Stats;
    try {
      stat = await fs.lstat(candidate);
    } catch (error) {
      if (hasErrnoCode(error, NOT_FOUND_CODES)) {
        const effectivePath = normalizeAbsolutePath(path.join(current, ...segments.slice(index)));
        checkedPaths.add(effectivePath);
        return {
          effectivePath,
          canonical: false,
          symlinkInvolved,
        };
      }
      if (hasErrnoCode(error, BLOCKED_RESOLUTION_CODES)) {
        return {
          effectivePath: candidate,
          canonical: false,
          symlinkInvolved,
          resolutionErrorCode: getErrnoCode(error),
        };
      }
      throw error;
    }

    if (!stat.isSymbolicLink()) {
      current = candidate;
      continue;
    }

    symlinkInvolved = true;

    let linkTarget: string;
    try {
      linkTarget = await fs.readlink(candidate);
    } catch (error) {
      if (hasErrnoCode(error, BLOCKED_RESOLUTION_CODES)) {
        return {
          effectivePath: candidate,
          canonical: false,
          symlinkInvolved: true,
          resolutionErrorCode: getErrnoCode(error),
        };
      }
      throw error;
    }

    const nextTarget = normalizeAbsolutePath(
      path.isAbsolute(linkTarget) ? linkTarget : path.resolve(path.dirname(candidate), linkTarget),
    );
    checkedPaths.add(nextTarget);

    const resolvedTarget = await resolvePathState(nextTarget, checkedPaths, symlinkDepth + 1);
    symlinkInvolved ||= resolvedTarget.symlinkInvolved;
    current = resolvedTarget.effectivePath;

    if (resolvedTarget.resolutionErrorCode) {
      return {
        effectivePath: current,
        canonical: false,
        symlinkInvolved: true,
        resolutionErrorCode: resolvedTarget.resolutionErrorCode,
      };
    }
  }

  const realpath = await tryRealpath(current);
  checkedPaths.add(realpath.effectivePath);
  return {
    effectivePath: realpath.effectivePath,
    canonical: realpath.canonical,
    symlinkInvolved:
      symlinkInvolved ||
      normalizeAbsolutePath(current) !== normalizeAbsolutePath(realpath.effectivePath),
    resolutionErrorCode: realpath.resolutionErrorCode,
  };
}

export async function safeResolvePath(targetPath: string): Promise<SafeResolvedPath> {
  const absolutePath = normalizeAbsolutePath(targetPath);
  const checkedPaths = new Set<string>([absolutePath]);
  const resolved = await resolvePathState(absolutePath, checkedPaths, 0);
  return {
    absolutePath,
    effectivePath: resolved.effectivePath,
    canonical: resolved.canonical,
    symlinkInvolved: resolved.symlinkInvolved,
    checkedPaths: [...checkedPaths],
    resolutionErrorCode: resolved.resolutionErrorCode,
  };
}

function resolvePathStateSync(
  targetPath: string,
  checkedPaths: Set<string>,
  symlinkDepth: number,
): {
  effectivePath: string;
  canonical: boolean;
  symlinkInvolved: boolean;
  resolutionErrorCode?: string;
} {
  const absolutePath = normalizeAbsolutePath(targetPath);
  checkedPaths.add(absolutePath);

  if (process.platform === "win32" && isWindowsUncPath(targetPath)) {
    return {
      effectivePath: absolutePath,
      canonical: false,
      symlinkInvolved: false,
      resolutionErrorCode: "UNC",
    };
  }

  if (symlinkDepth > MAX_SYMLINK_DEPTH) {
    return {
      effectivePath: absolutePath,
      canonical: false,
      symlinkInvolved: true,
      resolutionErrorCode: "ELOOP",
    };
  }

  const { root, segments } = splitPathSegments(absolutePath);
  let current = root;
  let symlinkInvolved = false;

  for (let index = 0; index < segments.length; index += 1) {
    const candidate = normalizeAbsolutePath(path.join(current, segments[index]));
    checkedPaths.add(candidate);

    let stat: fsSync.Stats;
    try {
      stat = fsSync.lstatSync(candidate);
    } catch (error) {
      if (hasErrnoCode(error, NOT_FOUND_CODES)) {
        const effectivePath = normalizeAbsolutePath(path.join(current, ...segments.slice(index)));
        checkedPaths.add(effectivePath);
        return {
          effectivePath,
          canonical: false,
          symlinkInvolved,
        };
      }
      if (hasErrnoCode(error, BLOCKED_RESOLUTION_CODES)) {
        return {
          effectivePath: candidate,
          canonical: false,
          symlinkInvolved,
          resolutionErrorCode: getErrnoCode(error),
        };
      }
      throw error;
    }

    if (!stat.isSymbolicLink()) {
      current = candidate;
      continue;
    }

    symlinkInvolved = true;

    let linkTarget: string;
    try {
      linkTarget = fsSync.readlinkSync(candidate);
    } catch (error) {
      if (hasErrnoCode(error, BLOCKED_RESOLUTION_CODES)) {
        return {
          effectivePath: candidate,
          canonical: false,
          symlinkInvolved: true,
          resolutionErrorCode: getErrnoCode(error),
        };
      }
      throw error;
    }

    const nextTarget = normalizeAbsolutePath(
      path.isAbsolute(linkTarget) ? linkTarget : path.resolve(path.dirname(candidate), linkTarget),
    );
    checkedPaths.add(nextTarget);

    const resolvedTarget = resolvePathStateSync(nextTarget, checkedPaths, symlinkDepth + 1);
    symlinkInvolved ||= resolvedTarget.symlinkInvolved;
    current = resolvedTarget.effectivePath;

    if (resolvedTarget.resolutionErrorCode) {
      return {
        effectivePath: current,
        canonical: false,
        symlinkInvolved: true,
        resolutionErrorCode: resolvedTarget.resolutionErrorCode,
      };
    }
  }

  const realpath = tryRealpathSync(current);
  checkedPaths.add(realpath.effectivePath);
  return {
    effectivePath: realpath.effectivePath,
    canonical: realpath.canonical,
    symlinkInvolved:
      symlinkInvolved ||
      normalizeAbsolutePath(current) !== normalizeAbsolutePath(realpath.effectivePath),
    resolutionErrorCode: realpath.resolutionErrorCode,
  };
}

export function safeResolvePathSync(targetPath: string): SafeResolvedPath {
  const absolutePath = normalizeAbsolutePath(targetPath);
  const checkedPaths = new Set<string>([absolutePath]);
  const resolved = resolvePathStateSync(absolutePath, checkedPaths, 0);
  return {
    absolutePath,
    effectivePath: resolved.effectivePath,
    canonical: resolved.canonical,
    symlinkInvolved: resolved.symlinkInvolved,
    checkedPaths: [...checkedPaths],
    resolutionErrorCode: resolved.resolutionErrorCode,
  };
}
