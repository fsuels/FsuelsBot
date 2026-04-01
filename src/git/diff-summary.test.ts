import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { collectGitWorkspaceSummary } from "./diff-summary.js";

async function makeTempDir(label: string): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), `openclaw-diff-${label}-`));
}

async function writeGitHead(workspaceDir: string): Promise<void> {
  await fs.mkdir(path.join(workspaceDir, ".git"), { recursive: true });
  await fs.writeFile(path.join(workspaceDir, ".git", "HEAD"), "ref: refs/heads/main\n", "utf8");
}

describe("collectGitWorkspaceSummary", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        await fs.rm(dir, { recursive: true, force: true });
      }
    }
  });

  it("skips per-file loading when the tracked diff is huge", async () => {
    const workspaceDir = await makeTempDir("huge");
    tempDirs.push(workspaceDir);
    await writeGitHead(workspaceDir);

    const runCommand = vi.fn(async (argv: string[]) => {
      if (argv.includes("--show-toplevel")) {
        return ok(`${workspaceDir}\n`);
      }
      if (argv.includes("--abbrev-ref")) {
        return ok("main\n");
      }
      if (argv.includes("--verify")) {
        return ok("deadbeef\n");
      }
      if (argv.includes("--others")) {
        return ok("");
      }
      if (argv.includes("HEAD") && argv.includes("--shortstat")) {
        return ok(" 501 files changed, 1200 insertions(+), 300 deletions(-)\n");
      }
      if (argv.includes("--cached") && argv.includes("--shortstat")) {
        return ok(" 2 files changed, 5 insertions(+)\n");
      }
      if (argv.at(-1) === "--shortstat") {
        return ok(" 3 files changed, 7 deletions(-)\n");
      }
      if (argv.includes("--numstat")) {
        throw new Error("numstat should not be called for huge diffs");
      }
      return ok("");
    });

    const summary = await collectGitWorkspaceSummary({
      workspaceDir,
      runCommand: runCommand as never,
    });

    expect(summary.isRepo).toBe(true);
    expect(summary.totalShortStat?.filesChanged).toBe(501);
    expect(summary.fileStats).toEqual([]);
    expect(summary.skippedDetailedStats).toBe(true);
  });

  it("tracks untracked files separately from tracked diff stats", async () => {
    const workspaceDir = await makeTempDir("untracked");
    tempDirs.push(workspaceDir);
    await writeGitHead(workspaceDir);

    const runCommand = vi.fn(async (argv: string[]) => {
      if (argv.includes("--show-toplevel")) {
        return ok(`${workspaceDir}\n`);
      }
      if (argv.includes("--abbrev-ref")) {
        return ok("main\n");
      }
      if (argv.includes("--verify")) {
        return ok("deadbeef\n");
      }
      if (argv.includes("--others")) {
        return ok("new-a.txt\nnew-b.txt\n");
      }
      if (argv.includes("HEAD") && argv.includes("--shortstat")) {
        return ok(" 2 files changed, 4 insertions(+), 1 deletion(-)\n");
      }
      if (argv.includes("HEAD") && argv.includes("--numstat")) {
        return ok("3\t1\tsrc/app.ts\n1\t0\tREADME.md\n");
      }
      return ok("");
    });

    const summary = await collectGitWorkspaceSummary({
      workspaceDir,
      runCommand: runCommand as never,
    });

    expect(summary.fileStats.map((entry) => entry.path)).toEqual(["src/app.ts", "README.md"]);
    expect(summary.untrackedFiles).toEqual(["new-a.txt", "new-b.txt"]);
  });

  it("skips tracked diff loading during transient merge state", async () => {
    const workspaceDir = await makeTempDir("merge");
    tempDirs.push(workspaceDir);
    await writeGitHead(workspaceDir);
    await fs.writeFile(path.join(workspaceDir, ".git", "MERGE_HEAD"), "deadbeef\n", "utf8");

    const runCommand = vi.fn(async (argv: string[]) => {
      if (argv.includes("--show-toplevel")) {
        return ok(`${workspaceDir}\n`);
      }
      if (argv.includes("--abbrev-ref")) {
        return ok("main\n");
      }
      if (argv.includes("--verify")) {
        return ok("deadbeef\n");
      }
      if (argv.includes("--others")) {
        return ok("pending.txt\n");
      }
      if (argv.includes("--numstat")) {
        throw new Error("numstat should not be called during merge state");
      }
      return ok("");
    });

    const summary = await collectGitWorkspaceSummary({
      workspaceDir,
      runCommand: runCommand as never,
    });

    expect(summary.transientState).toBe("MERGE_HEAD");
    expect(summary.skippedDetailedStats).toBe(true);
    expect(summary.untrackedFiles).toEqual(["pending.txt"]);
  });
});

function ok(stdout: string) {
  return {
    stdout,
    stderr: "",
    code: 0,
    signal: null,
    killed: false,
  };
}
