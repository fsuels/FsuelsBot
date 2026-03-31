import path from "node:path";
import { runCommandWithTimeout } from "../../process/exec.js";

export type SessionWorkspaceFingerprint = {
  agentId?: string;
  workspaceDir?: string;
  cwd?: string;
  repoRoot?: string;
  gitCommonDir?: string;
  gitBranch?: string;
  gitRemotes?: string[];
};

export type SessionWorkspaceRelation = "exact" | "same_repo" | "different" | "unverified";

export type SessionWorkspaceMatch = {
  relation: SessionWorkspaceRelation;
};

function normalizePathValue(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  return path.resolve(trimmed);
}

function normalizeStringValue(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const normalized = [...new Set(value.map(normalizeStringValue).filter(Boolean))].toSorted();
  return normalized.length > 0 ? normalized : undefined;
}

function arraysEqual(left?: string[], right?: string[]): boolean {
  if (!left || !right || left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}

function resolveMaybeRelative(baseDir: string, value: string | null): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  return path.isAbsolute(trimmed) ? path.resolve(trimmed) : path.resolve(baseDir, trimmed);
}

async function runGitText(
  argv: string[],
  cwd: string,
  timeoutMs: number,
  runCommand: typeof runCommandWithTimeout,
): Promise<string | null> {
  const result = await runCommand(argv, {
    cwd,
    timeoutMs,
  }).catch(() => null);
  if (!result || result.code !== 0) {
    return null;
  }
  const output = result.stdout.trim();
  return output || null;
}

async function readGitRemotes(
  cwd: string,
  timeoutMs: number,
  runCommand: typeof runCommandWithTimeout,
): Promise<string[] | undefined> {
  const output = await runGitText(
    ["git", "-C", cwd, "config", "--get-regexp", "^remote\\..*\\.url$"],
    cwd,
    timeoutMs,
    runCommand,
  );
  if (!output) {
    return undefined;
  }
  const remotes = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^remote\.[^.]+\.url\s+(.+)$/);
      return match?.[1]?.trim();
    })
    .filter((value): value is string => Boolean(value));
  return normalizeStringArray(remotes);
}

export function normalizeSessionWorkspaceFingerprint(
  value: unknown,
): SessionWorkspaceFingerprint | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const normalized: SessionWorkspaceFingerprint = {
    agentId: normalizeStringValue(record.agentId),
    workspaceDir: normalizePathValue(record.workspaceDir),
    cwd: normalizePathValue(record.cwd),
    repoRoot: normalizePathValue(record.repoRoot),
    gitCommonDir: normalizePathValue(record.gitCommonDir),
    gitBranch: normalizeStringValue(record.gitBranch),
    gitRemotes: normalizeStringArray(record.gitRemotes),
  };
  return Object.values(normalized).some((entry) =>
    Array.isArray(entry) ? entry.length > 0 : Boolean(entry),
  )
    ? normalized
    : undefined;
}

export async function captureSessionWorkspaceFingerprint(params: {
  workspaceDir?: string;
  cwd?: string;
  agentId?: string;
  timeoutMs?: number;
  runCommand?: typeof runCommandWithTimeout;
}): Promise<SessionWorkspaceFingerprint | undefined> {
  const workspaceDir = normalizePathValue(params.workspaceDir);
  const cwd = normalizePathValue(params.cwd ?? process.cwd());
  const agentId = normalizeStringValue(params.agentId);
  const probeDir = workspaceDir ?? cwd;
  const timeoutMs =
    typeof params.timeoutMs === "number" && Number.isFinite(params.timeoutMs)
      ? Math.max(100, Math.floor(params.timeoutMs))
      : 1_500;
  const runCommand = params.runCommand ?? runCommandWithTimeout;

  const fingerprint: SessionWorkspaceFingerprint = {
    ...(agentId ? { agentId } : {}),
    ...(workspaceDir ? { workspaceDir } : {}),
    ...(cwd ? { cwd } : {}),
  };

  if (!probeDir) {
    return normalizeSessionWorkspaceFingerprint(fingerprint);
  }

  const [repoRootRaw, gitCommonDirRaw, gitBranch, gitRemotes] = await Promise.all([
    runGitText(
      ["git", "-C", probeDir, "rev-parse", "--show-toplevel"],
      probeDir,
      timeoutMs,
      runCommand,
    ),
    runGitText(
      ["git", "-C", probeDir, "rev-parse", "--git-common-dir"],
      probeDir,
      timeoutMs,
      runCommand,
    ),
    runGitText(
      ["git", "-C", probeDir, "rev-parse", "--abbrev-ref", "HEAD"],
      probeDir,
      timeoutMs,
      runCommand,
    ),
    readGitRemotes(probeDir, timeoutMs, runCommand),
  ]);

  const repoRoot = resolveMaybeRelative(probeDir, repoRootRaw);
  const gitCommonDir = resolveMaybeRelative(probeDir, gitCommonDirRaw);
  return normalizeSessionWorkspaceFingerprint({
    ...fingerprint,
    ...(repoRoot ? { repoRoot } : {}),
    ...(gitCommonDir ? { gitCommonDir } : {}),
    ...(gitBranch ? { gitBranch } : {}),
    ...(gitRemotes ? { gitRemotes } : {}),
  });
}

export function classifySessionWorkspaceMatch(params: {
  current?: SessionWorkspaceFingerprint;
  stored?: SessionWorkspaceFingerprint;
}): SessionWorkspaceMatch {
  const current = normalizeSessionWorkspaceFingerprint(params.current);
  const stored = normalizeSessionWorkspaceFingerprint(params.stored);
  if (!current || !stored) {
    return { relation: "unverified" };
  }

  const sameWorkspace =
    (current.workspaceDir && stored.workspaceDir && current.workspaceDir === stored.workspaceDir) ||
    (current.cwd && stored.cwd && current.cwd === stored.cwd);
  if (sameWorkspace) {
    return { relation: "exact" };
  }

  const currentRepoId = current.gitCommonDir ?? current.repoRoot;
  const storedRepoId = stored.gitCommonDir ?? stored.repoRoot;
  if (currentRepoId && storedRepoId) {
    return {
      relation: currentRepoId === storedRepoId ? "same_repo" : "different",
    };
  }

  if (current.repoRoot && stored.repoRoot) {
    return {
      relation: current.repoRoot === stored.repoRoot ? "same_repo" : "different",
    };
  }

  if (arraysEqual(current.gitRemotes, stored.gitRemotes) && current.gitRemotes?.length) {
    return { relation: "same_repo" };
  }

  if (current.workspaceDir && stored.workspaceDir && current.workspaceDir !== stored.workspaceDir) {
    return { relation: "different" };
  }

  return { relation: "unverified" };
}

export function formatSessionWorkspaceSummary(fingerprint?: SessionWorkspaceFingerprint): string {
  const normalized = normalizeSessionWorkspaceFingerprint(fingerprint);
  if (!normalized) {
    return "workspace unavailable";
  }
  const parts = [
    normalized.workspaceDir ? `workspace=${normalized.workspaceDir}` : undefined,
    normalized.repoRoot ? `repo=${normalized.repoRoot}` : undefined,
    normalized.gitBranch ? `branch=${normalized.gitBranch}` : undefined,
    normalized.gitRemotes?.length ? `remotes=${normalized.gitRemotes.join(", ")}` : undefined,
  ].filter(Boolean);
  return parts.join(" | ") || "workspace unavailable";
}
