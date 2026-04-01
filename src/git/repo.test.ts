import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  findCanonicalGitRoot,
  findGitRoot,
  hashGitRepositoryIdentity,
  inspectGitRepository,
  isBareGitRepoCandidate,
  normalizeGitRemoteUrl,
} from "./repo.js";

async function makeTempDir(label: string): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), `openclaw-git-${label}-`));
}

async function writeFile(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

async function realPath(value: string): Promise<string> {
  return await fs.realpath(value);
}

describe("git repo helpers", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        await fs.rm(dir, { recursive: true, force: true });
      }
    }
  });

  it("detects a normal repository root", async () => {
    const root = await makeTempDir("normal");
    tempDirs.push(root);
    await writeFile(path.join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
    const expectedRoot = await realPath(root);

    expect(findGitRoot(path.join(root, "src"))).toBe(expectedRoot);
    expect(findCanonicalGitRoot(path.join(root, "src"))).toBe(expectedRoot);
    expect(inspectGitRepository(path.join(root, "src"))).toMatchObject({
      gitRoot: expectedRoot,
      canonicalRoot: expectedRoot,
      gitDir: path.join(expectedRoot, ".git"),
      gitCommonDir: path.join(expectedRoot, ".git"),
      bareRepoDetected: false,
    });
  });

  it("resolves worktrees to the main repo identity when backlinks validate", async () => {
    const root = await makeTempDir("worktree-main");
    const worktree = await makeTempDir("worktree-child");
    tempDirs.push(root, worktree);

    await writeFile(path.join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
    const worktreeGitDir = path.join(root, ".git", "worktrees", "feature-a");
    await writeFile(path.join(worktreeGitDir, "HEAD"), "ref: refs/heads/feature-a\n");
    await writeFile(path.join(worktreeGitDir, "commondir"), "../..\n");
    await writeFile(path.join(worktreeGitDir, "gitdir"), path.join(worktree, ".git"));
    await writeFile(path.join(worktree, ".git"), `gitdir: ${worktreeGitDir}\n`);
    const expectedRoot = await realPath(root);
    const expectedWorktree = await realPath(worktree);

    const inspected = inspectGitRepository(path.join(worktree, "nested"));
    expect(inspected).toMatchObject({
      gitRoot: expectedWorktree,
      canonicalRoot: expectedRoot,
      gitDir: path.join(expectedRoot, ".git", "worktrees", "feature-a"),
      gitCommonDir: path.join(expectedRoot, ".git"),
      bareRepoDetected: false,
    });
  });

  it("falls back to the local root when a worktree backlink is suspicious", async () => {
    const root = await makeTempDir("malicious-main");
    const worktree = await makeTempDir("malicious-child");
    tempDirs.push(root, worktree);

    await writeFile(path.join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
    const worktreeGitDir = path.join(root, ".git", "worktrees", "feature-b");
    await writeFile(path.join(worktreeGitDir, "HEAD"), "ref: refs/heads/feature-b\n");
    await writeFile(path.join(worktreeGitDir, "commondir"), "../..\n");
    await writeFile(path.join(worktreeGitDir, "gitdir"), path.join(root, ".git"));
    await writeFile(path.join(worktree, ".git"), `gitdir: ${worktreeGitDir}\n`);

    expect(findCanonicalGitRoot(worktree)).toBe(await realPath(worktree));
  });

  it("does not confuse submodule-style git files for worktrees", async () => {
    const root = await makeTempDir("submodule-parent");
    tempDirs.push(root);
    const submodule = path.join(root, "vendor", "pkg");
    const submoduleGitDir = path.join(root, ".git", "modules", "vendor", "pkg");
    await fs.mkdir(submodule, { recursive: true });
    await writeFile(path.join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
    await writeFile(path.join(submoduleGitDir, "HEAD"), "ref: refs/heads/main\n");
    await writeFile(path.join(submoduleGitDir, "commondir"), "../../..\n");
    await writeFile(path.join(submodule, ".git"), `gitdir: ${submoduleGitDir}\n`);

    expect(findGitRoot(path.join(submodule, "src"))).toBe(await realPath(submodule));
    expect(findCanonicalGitRoot(path.join(submodule, "src"))).toBe(await realPath(submodule));
  });

  it("normalizes symlinked paths to the real repo root", async () => {
    if (process.platform === "win32") {
      return;
    }
    const root = await makeTempDir("symlink-root");
    tempDirs.push(root);
    const linkParent = await makeTempDir("symlink-parent");
    tempDirs.push(linkParent);
    await writeFile(path.join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
    const linked = path.join(linkParent, "linked-repo");
    await fs.symlink(root, linked, "dir");
    const expectedRoot = await realPath(root);

    expect(findGitRoot(path.join(linked, "src"))).toBe(expectedRoot);
    expect(findCanonicalGitRoot(path.join(linked, "src"))).toBe(expectedRoot);
  });

  it("flags bare repo indicators without a .git directory", async () => {
    const bare = await makeTempDir("bare");
    tempDirs.push(bare);
    await writeFile(path.join(bare, "HEAD"), "ref: refs/heads/main\n");
    await fs.mkdir(path.join(bare, "objects"), { recursive: true });
    await fs.mkdir(path.join(bare, "refs"), { recursive: true });

    expect(findGitRoot(bare)).toBeNull();
    expect(isBareGitRepoCandidate(bare)).toBe(true);
  });

  it("normalizes remote urls and produces a stable hash", () => {
    expect(normalizeGitRemoteUrl("git@github.com:OpenClaw/OpenClaw.git")).toBe(
      "github.com/OpenClaw/OpenClaw",
    );
    expect(normalizeGitRemoteUrl("https://github.com/OpenClaw/OpenClaw.git")).toBe(
      "github.com/OpenClaw/OpenClaw",
    );
    expect(
      hashGitRepositoryIdentity({
        remotes: [
          "git@github.com:OpenClaw/OpenClaw.git",
          "https://github.com/OpenClaw/OpenClaw.git",
        ],
      }),
    ).toMatch(/^[a-f0-9]{16}$/);
  });
});
