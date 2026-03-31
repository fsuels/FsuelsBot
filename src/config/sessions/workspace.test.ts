import { describe, expect, it, vi } from "vitest";
import {
  captureSessionWorkspaceFingerprint,
  classifySessionWorkspaceMatch,
  normalizeSessionWorkspaceFingerprint,
} from "./workspace.js";

describe("session workspace fingerprints", () => {
  it("captures git metadata when available", async () => {
    const runCommand = vi.fn(async (argv: string[]) => {
      if (argv.includes("--show-toplevel")) {
        return {
          stdout: "/tmp/worktrees/alpha\n",
          stderr: "",
          code: 0,
          signal: null,
          killed: false,
        };
      }
      if (argv.includes("--git-common-dir")) {
        return { stdout: "/tmp/repo/.git\n", stderr: "", code: 0, signal: null, killed: false };
      }
      if (argv.includes("--abbrev-ref")) {
        return {
          stdout: "feature/resume-guard\n",
          stderr: "",
          code: 0,
          signal: null,
          killed: false,
        };
      }
      return {
        stdout: "remote.origin.url git@github.com:example/openclaw.git\n",
        stderr: "",
        code: 0,
        signal: null,
        killed: false,
      };
    });

    const fingerprint = await captureSessionWorkspaceFingerprint({
      workspaceDir: "/tmp/worktrees/alpha",
      cwd: "/tmp/worktrees/alpha",
      agentId: "main",
      runCommand: runCommand as never,
    });

    expect(fingerprint).toEqual({
      agentId: "main",
      workspaceDir: "/tmp/worktrees/alpha",
      cwd: "/tmp/worktrees/alpha",
      repoRoot: "/tmp/worktrees/alpha",
      gitCommonDir: "/tmp/repo/.git",
      gitBranch: "feature/resume-guard",
      gitRemotes: ["git@github.com:example/openclaw.git"],
    });
  });

  it("classifies same-repo worktrees separately from exact workspace matches", () => {
    const exact = classifySessionWorkspaceMatch({
      current: { workspaceDir: "/tmp/worktrees/a", gitCommonDir: "/tmp/repo/.git" },
      stored: { workspaceDir: "/tmp/worktrees/a", gitCommonDir: "/tmp/repo/.git" },
    });
    expect(exact.relation).toBe("exact");

    const sameRepo = classifySessionWorkspaceMatch({
      current: { workspaceDir: "/tmp/worktrees/b", gitCommonDir: "/tmp/repo/.git" },
      stored: { workspaceDir: "/tmp/worktrees/a", gitCommonDir: "/tmp/repo/.git" },
    });
    expect(sameRepo.relation).toBe("same_repo");
  });

  it("treats different repos as different workspaces", () => {
    const result = classifySessionWorkspaceMatch({
      current: {
        workspaceDir: "/tmp/repo-b",
        repoRoot: "/tmp/repo-b",
        gitCommonDir: "/tmp/repo-b/.git",
      },
      stored: {
        workspaceDir: "/tmp/repo-a",
        repoRoot: "/tmp/repo-a",
        gitCommonDir: "/tmp/repo-a/.git",
      },
    });

    expect(result.relation).toBe("different");
  });

  it("normalizes malformed metadata into an unverified state", () => {
    expect(
      normalizeSessionWorkspaceFingerprint({ workspaceDir: 42, gitRemotes: [7] }),
    ).toBeUndefined();

    const result = classifySessionWorkspaceMatch({
      current: { workspaceDir: "/tmp/current" },
      stored: normalizeSessionWorkspaceFingerprint({ workspaceDir: 42 }),
    });
    expect(result.relation).toBe("unverified");
  });
});
