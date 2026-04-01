import fs from "node:fs/promises";
import path from "node:path";
import { runCommandWithTimeout, type SpawnResult } from "../process/exec.js";
import { inspectGitRepository } from "./repo.js";

const DIFF_TIMEOUT_MS = 5_000;
const MAX_TRACKED_FILES_FOR_DETAIL = 500;
const MAX_TRACKED_FILE_STATS = 50;

export type GitWorkspaceFileStat = {
  path: string;
  added?: number;
  deleted?: number;
  kind: "tracked" | "untracked";
};

export type GitShortStat = {
  filesChanged: number;
  insertions: number;
  deletions: number;
  line: string;
};

export type GitWorkspaceSummary = {
  hasGit: boolean;
  workspaceExists: boolean;
  isRepo: boolean;
  repoRoot?: string;
  canonicalRepoRoot?: string;
  branch?: string;
  totalShortStat?: GitShortStat;
  stagedShortStat?: GitShortStat;
  unstagedShortStat?: GitShortStat;
  fileStats: GitWorkspaceFileStat[];
  untrackedFiles: string[];
  skippedDetailedStats: boolean;
  transientState?: string;
  error?: string;
};

type RunCommand = typeof runCommandWithTimeout;

function splitNonEmptyLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function isGitMissing(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code === "ENOENT"
  );
}

function isNotGitRepo(stderr: string, stdout = ""): boolean {
  const combined = `${stderr}\n${stdout}`.toLowerCase();
  return (
    combined.includes("not a git repository") ||
    combined.includes("unable to change to") ||
    combined.includes("cannot change to")
  );
}

function parseShortStat(value: string | null | undefined): GitShortStat | undefined {
  const line = value?.trim();
  if (!line) {
    return undefined;
  }
  const filesChanged = Number(line.match(/(\d+)\s+files?\s+changed/)?.[1] ?? "0");
  const insertions = Number(line.match(/(\d+)\s+insertions?\(\+\)/)?.[1] ?? "0");
  const deletions = Number(line.match(/(\d+)\s+deletions?\(-\)/)?.[1] ?? "0");
  if (filesChanged === 0 && insertions === 0 && deletions === 0) {
    return undefined;
  }
  return { filesChanged, insertions, deletions, line };
}

function parseNumStatLines(value: string | null | undefined): GitWorkspaceFileStat[] {
  const lines = splitNonEmptyLines(value ?? "");
  const stats: GitWorkspaceFileStat[] = [];
  for (const line of lines) {
    const [addedRaw, deletedRaw, ...pathParts] = line.split("\t");
    const filePath = pathParts.join("\t").trim();
    if (!filePath) {
      continue;
    }
    const added = addedRaw === "-" ? undefined : Number(addedRaw);
    const deleted = deletedRaw === "-" ? undefined : Number(deletedRaw);
    stats.push({
      path: filePath,
      added: Number.isFinite(added) ? added : undefined,
      deleted: Number.isFinite(deleted) ? deleted : undefined,
      kind: "tracked",
    });
  }
  return stats;
}

function mergeFileStats(parts: GitWorkspaceFileStat[][]): GitWorkspaceFileStat[] {
  const merged = new Map<string, GitWorkspaceFileStat>();
  for (const entries of parts) {
    for (const entry of entries) {
      const current = merged.get(entry.path);
      if (!current) {
        merged.set(entry.path, { ...entry });
        continue;
      }
      merged.set(entry.path, {
        path: entry.path,
        kind: "tracked",
        added: (current.added ?? 0) + (entry.added ?? 0),
        deleted: (current.deleted ?? 0) + (entry.deleted ?? 0),
      });
    }
  }
  return [...merged.values()];
}

async function runGit(
  workspaceDir: string,
  args: string[],
  runCommand: RunCommand,
): Promise<SpawnResult | null> {
  return await runCommand(["git", "-C", workspaceDir, ...args], {
    cwd: workspaceDir,
    timeoutMs: DIFF_TIMEOUT_MS,
  }).catch(() => null);
}

async function runGitText(
  workspaceDir: string,
  args: string[],
  runCommand: RunCommand,
): Promise<string | null> {
  const result = await runGit(workspaceDir, args, runCommand);
  if (!result || result.code !== 0) {
    return null;
  }
  const text = result.stdout.trim();
  return text || null;
}

async function readTransientGitState(gitDir: string | undefined): Promise<string | undefined> {
  if (!gitDir) {
    return undefined;
  }
  const states = ["MERGE_HEAD", "REBASE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD"] as const;
  for (const state of states) {
    try {
      await fs.access(path.join(gitDir, state));
      return state;
    } catch {
      // keep probing
    }
  }
  return undefined;
}

export async function collectGitWorkspaceSummary(params: {
  workspaceDir: string;
  runCommand?: RunCommand;
}): Promise<GitWorkspaceSummary> {
  const workspaceExists = await fs
    .access(params.workspaceDir)
    .then(() => true)
    .catch(() => false);
  if (!workspaceExists) {
    return {
      hasGit: false,
      workspaceExists: false,
      isRepo: false,
      fileStats: [],
      untrackedFiles: [],
      skippedDetailedStats: false,
      error: `workspace missing: ${params.workspaceDir}`,
    };
  }

  const runCommand = params.runCommand ?? runCommandWithTimeout;
  const inspected = inspectGitRepository(params.workspaceDir);

  try {
    const repoRootResult = await runGit(
      params.workspaceDir,
      ["rev-parse", "--show-toplevel"],
      runCommand,
    );
    if (!repoRootResult) {
      return {
        hasGit: false,
        workspaceExists: true,
        isRepo: false,
        fileStats: [],
        untrackedFiles: [],
        skippedDetailedStats: false,
        error: "git probe failed",
      };
    }
    if (repoRootResult.code !== 0) {
      return {
        hasGit: true,
        workspaceExists: true,
        isRepo: false,
        fileStats: [],
        untrackedFiles: [],
        skippedDetailedStats: false,
        error: splitNonEmptyLines(repoRootResult.stderr || repoRootResult.stdout)[0],
      };
    }

    const repoRoot = repoRootResult.stdout.trim() || inspected?.gitRoot || params.workspaceDir;
    const branch = await runGitText(
      params.workspaceDir,
      ["rev-parse", "--abbrev-ref", "HEAD"],
      runCommand,
    );
    const transientState = await readTransientGitState(inspected?.gitDir);
    const untrackedOutput = await runGitText(
      params.workspaceDir,
      ["ls-files", "--others", "--exclude-standard"],
      runCommand,
    );
    const untrackedFiles = splitNonEmptyLines(untrackedOutput ?? "");

    const stagedShortStat = parseShortStat(
      await runGitText(params.workspaceDir, ["diff", "--cached", "--shortstat"], runCommand),
    );
    const unstagedShortStat = parseShortStat(
      await runGitText(params.workspaceDir, ["diff", "--shortstat"], runCommand),
    );

    const hasHeadResult = await runGit(
      params.workspaceDir,
      ["rev-parse", "--verify", "HEAD"],
      runCommand,
    );
    const hasHead = Boolean(hasHeadResult && hasHeadResult.code === 0);
    const totalShortStat = hasHead
      ? parseShortStat(
          await runGitText(params.workspaceDir, ["diff", "HEAD", "--shortstat"], runCommand),
        )
      : undefined;

    if (transientState) {
      return {
        hasGit: true,
        workspaceExists: true,
        isRepo: true,
        repoRoot,
        canonicalRepoRoot: inspected?.canonicalRoot,
        branch: branch ?? undefined,
        totalShortStat,
        stagedShortStat,
        unstagedShortStat,
        fileStats: [],
        untrackedFiles,
        skippedDetailedStats: true,
        transientState,
      };
    }

    const trackedFileCount = totalShortStat?.filesChanged ?? 0;
    if (trackedFileCount > MAX_TRACKED_FILES_FOR_DETAIL) {
      return {
        hasGit: true,
        workspaceExists: true,
        isRepo: true,
        repoRoot,
        canonicalRepoRoot: inspected?.canonicalRoot,
        branch: branch ?? undefined,
        totalShortStat,
        stagedShortStat,
        unstagedShortStat,
        fileStats: [],
        untrackedFiles,
        skippedDetailedStats: true,
      };
    }

    const trackedStats = hasHead
      ? parseNumStatLines(
          await runGitText(params.workspaceDir, ["diff", "HEAD", "--numstat"], runCommand),
        )
      : mergeFileStats([
          parseNumStatLines(
            await runGitText(params.workspaceDir, ["diff", "--cached", "--numstat"], runCommand),
          ),
          parseNumStatLines(
            await runGitText(params.workspaceDir, ["diff", "--numstat"], runCommand),
          ),
        ]);

    return {
      hasGit: true,
      workspaceExists: true,
      isRepo: true,
      repoRoot,
      canonicalRepoRoot: inspected?.canonicalRoot,
      branch: branch ?? undefined,
      totalShortStat,
      stagedShortStat,
      unstagedShortStat,
      fileStats: trackedStats.slice(0, MAX_TRACKED_FILE_STATS),
      untrackedFiles,
      skippedDetailedStats: trackedStats.length > MAX_TRACKED_FILE_STATS,
    };
  } catch (error) {
    if (isGitMissing(error)) {
      return {
        hasGit: false,
        workspaceExists: true,
        isRepo: false,
        fileStats: [],
        untrackedFiles: [],
        skippedDetailedStats: false,
        error: "git is not installed",
      };
    }

    const detail = error instanceof Error ? error.message : String(error);
    if (isNotGitRepo(detail)) {
      return {
        hasGit: true,
        workspaceExists: true,
        isRepo: false,
        fileStats: [],
        untrackedFiles: [],
        skippedDetailedStats: false,
        error: detail,
      };
    }

    return {
      hasGit: true,
      workspaceExists: true,
      isRepo: false,
      fileStats: [],
      untrackedFiles: [],
      skippedDetailedStats: false,
      error: detail,
    };
  }
}
