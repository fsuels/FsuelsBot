import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const GIT_ROOT_CACHE_LIMIT = 64;
const gitRootCache = new Map<string, string | null>();

export type GitRepositoryIdentity = {
  gitRoot: string;
  canonicalRoot: string;
  gitDir?: string;
  gitCommonDir?: string;
  bareRepoDetected: boolean;
};

function normalizePathValue(value: string): string {
  const resolved = path.resolve(value).normalize("NFC");
  if (process.platform !== "win32") {
    return resolved;
  }
  return resolved.replace(/^[A-Z]:/, (match) => match.toLowerCase());
}

function normalizeExistingPath(value: string): string {
  try {
    return normalizePathValue(fs.realpathSync.native(value));
  } catch {
    return normalizePathValue(value);
  }
}

function normalizeComparisonPath(value: string): string {
  return normalizeExistingPath(value);
}

function resolveSearchStart(startPath: string): string {
  const resolved = normalizePathValue(startPath);
  try {
    const stat = fs.statSync(resolved);
    return stat.isDirectory() ? resolved : normalizePathValue(path.dirname(resolved));
  } catch {
    return resolved;
  }
}

function readGitRootCache(key: string): string | null | undefined {
  if (!gitRootCache.has(key)) {
    return undefined;
  }
  const value = gitRootCache.get(key) ?? null;
  gitRootCache.delete(key);
  gitRootCache.set(key, value);
  return value;
}

function writeGitRootCache(key: string, value: string | null): void {
  if (gitRootCache.has(key)) {
    gitRootCache.delete(key);
  }
  gitRootCache.set(key, value);
  while (gitRootCache.size > GIT_ROOT_CACHE_LIMIT) {
    const oldestKey = gitRootCache.keys().next().value;
    if (typeof oldestKey !== "string") {
      break;
    }
    gitRootCache.delete(oldestKey);
  }
}

function hasGitEntry(dir: string): boolean {
  try {
    const stat = fs.statSync(path.join(dir, ".git"));
    return stat.isDirectory() || stat.isFile();
  } catch {
    return false;
  }
}

function readGitDirPointer(gitFilePath: string): string | undefined {
  try {
    const raw = fs.readFileSync(gitFilePath, "utf8");
    const match = raw.match(/^\s*gitdir:\s*(.+?)\s*$/im);
    if (!match?.[1]) {
      return undefined;
    }
    const pointer = match[1].trim();
    return path.isAbsolute(pointer) ? pointer : path.resolve(path.dirname(gitFilePath), pointer);
  } catch {
    return undefined;
  }
}

function readCommonDir(gitDir: string): string | undefined {
  try {
    const raw = fs.readFileSync(path.join(gitDir, "commondir"), "utf8").trim();
    if (!raw) {
      return gitDir;
    }
    return path.isAbsolute(raw) ? raw : path.resolve(gitDir, raw);
  } catch {
    return gitDir;
  }
}

function hasValidGitHead(gitDir: string): boolean {
  try {
    return fs.statSync(path.join(gitDir, "HEAD")).isFile();
  } catch {
    return false;
  }
}

function hasBareRepoIndicators(dir: string): boolean {
  try {
    const headOk = fs.statSync(path.join(dir, "HEAD")).isFile();
    const objectsOk = fs.statSync(path.join(dir, "objects")).isDirectory();
    const refsOk = fs.statSync(path.join(dir, "refs")).isDirectory();
    return headOk && objectsOk && refsOk;
  } catch {
    return false;
  }
}

function isPathWithin(candidate: string, container: string): boolean {
  const relative = path.relative(container, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function validateWorktreeCanonicalRoot(params: {
  gitRoot: string;
  gitDir: string;
  gitCommonDir: string;
}): string | undefined {
  const worktreesDir = normalizeExistingPath(path.join(params.gitCommonDir, "worktrees"));
  if (!isPathWithin(params.gitDir, worktreesDir)) {
    return undefined;
  }

  const backlinkPath = path.join(params.gitDir, "gitdir");
  let backlink: string;
  try {
    backlink = fs.readFileSync(backlinkPath, "utf8").trim();
  } catch {
    return undefined;
  }
  if (!backlink) {
    return undefined;
  }

  const resolvedBacklink = normalizeComparisonPath(
    path.isAbsolute(backlink) ? backlink : path.resolve(params.gitDir, backlink),
  );
  const expectedBacklink = normalizeComparisonPath(path.join(params.gitRoot, ".git"));
  if (resolvedBacklink !== expectedBacklink) {
    return undefined;
  }

  if (!hasValidGitHead(params.gitCommonDir)) {
    return undefined;
  }

  return normalizeExistingPath(path.dirname(params.gitCommonDir));
}

export function findGitRoot(startPath: string): string | null {
  const startDir = resolveSearchStart(startPath);
  const cached = readGitRootCache(startDir);
  if (cached !== undefined) {
    return cached;
  }

  let current = startDir;
  while (true) {
    if (hasGitEntry(current)) {
      const found = normalizeExistingPath(current);
      writeGitRootCache(startDir, found);
      return found;
    }

    const parent = normalizePathValue(path.dirname(current));
    if (parent === current) {
      break;
    }
    current = parent;
  }

  writeGitRootCache(startDir, null);
  return null;
}

export function inspectGitRepository(startPath: string): GitRepositoryIdentity | undefined {
  const gitRoot = findGitRoot(startPath);
  const searchStart = resolveSearchStart(startPath);
  if (!gitRoot) {
    return hasBareRepoIndicators(searchStart)
      ? {
          gitRoot: searchStart,
          canonicalRoot: searchStart,
          bareRepoDetected: true,
        }
      : undefined;
  }

  const normalizedGitRoot = normalizeExistingPath(gitRoot);
  const gitEntryPath = path.join(normalizedGitRoot, ".git");
  let gitDir: string | undefined;
  let gitCommonDir: string | undefined;

  try {
    const stat = fs.statSync(gitEntryPath);
    if (stat.isDirectory()) {
      gitDir = normalizeExistingPath(gitEntryPath);
      gitCommonDir = gitDir;
      return {
        gitRoot: normalizedGitRoot,
        canonicalRoot: normalizedGitRoot,
        gitDir,
        gitCommonDir,
        bareRepoDetected: false,
      };
    }

    if (!stat.isFile()) {
      return {
        gitRoot: normalizedGitRoot,
        canonicalRoot: normalizedGitRoot,
        bareRepoDetected: false,
      };
    }

    const pointer = readGitDirPointer(gitEntryPath);
    if (!pointer) {
      return {
        gitRoot: normalizedGitRoot,
        canonicalRoot: normalizedGitRoot,
        bareRepoDetected: false,
      };
    }

    gitDir = normalizeExistingPath(pointer);
    gitCommonDir = normalizeExistingPath(readCommonDir(pointer) ?? pointer);
    const canonicalRoot =
      validateWorktreeCanonicalRoot({
        gitRoot: normalizedGitRoot,
        gitDir,
        gitCommonDir,
      }) ?? normalizedGitRoot;

    return {
      gitRoot: normalizedGitRoot,
      canonicalRoot,
      gitDir,
      gitCommonDir,
      bareRepoDetected: false,
    };
  } catch {
    return {
      gitRoot: normalizedGitRoot,
      canonicalRoot: normalizedGitRoot,
      gitDir,
      gitCommonDir,
      bareRepoDetected: false,
    };
  }
}

export function findCanonicalGitRoot(startPath: string): string | null {
  return inspectGitRepository(startPath)?.canonicalRoot ?? null;
}

export function isBareGitRepoCandidate(startPath: string): boolean {
  const inspected = inspectGitRepository(startPath);
  return inspected?.bareRepoDetected === true;
}

export function normalizeGitRemoteUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  const scpLike = trimmed.match(/^(?:([^@]+)@)?([^:/\\]+):(.+)$/);
  if (!trimmed.includes("://") && scpLike?.[2] && scpLike[3]) {
    const host = scpLike[2].toLowerCase();
    const repoPath = scpLike[3]
      .replace(/^\//, "")
      .replace(/\.git$/i, "")
      .replace(/\/+$/, "");
    return repoPath ? `${host}/${repoPath}` : host;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "file:") {
      return `file://${normalizeExistingPath(fileURLToPath(parsed))}`;
    }
    const host = parsed.hostname.toLowerCase();
    const defaultPort =
      (parsed.protocol === "https:" && parsed.port === "443") ||
      (parsed.protocol === "ssh:" && parsed.port === "22") ||
      (parsed.protocol === "git:" && parsed.port === "9418");
    const port = parsed.port && !defaultPort ? `:${parsed.port}` : "";
    const repoPath = parsed.pathname
      .replace(/^\/+/, "")
      .replace(/\.git$/i, "")
      .replace(/\/+$/, "");
    return repoPath ? `${host}${port}/${repoPath}` : `${host}${port}`;
  } catch {
    return `file://${normalizeExistingPath(trimmed.replace(/\.git$/i, ""))}`;
  }
}

export function hashGitRepositoryIdentity(params: {
  canonicalRoot?: string;
  gitCommonDir?: string;
  remotes?: string[];
}): string | undefined {
  const remotes = Array.isArray(params.remotes)
    ? params.remotes
        .map((remote) => normalizeGitRemoteUrl(remote))
        .filter((remote): remote is string => Boolean(remote))
    : [];
  const parts =
    remotes.length > 0
      ? [...new Set(remotes)].toSorted((left, right) => left.localeCompare(right))
      : [params.gitCommonDir ?? params.canonicalRoot].filter(Boolean);
  if (parts.length === 0) {
    return undefined;
  }
  return crypto.createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 16);
}
