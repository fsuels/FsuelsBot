import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertSandboxPath } from "./sandbox-paths.js";

describe("assertSandboxPath", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-sandbox-paths-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("allows symlinks that stay within the sandbox root", async () => {
    const rootDir = path.join(tmpDir, "root");
    const nestedDir = path.join(rootDir, "nested");
    await fs.mkdir(nestedDir, { recursive: true });
    const targetFile = path.join(nestedDir, "safe.txt");
    await fs.writeFile(targetFile, "ok", "utf8");
    const linkDir = path.join(rootDir, "linked");

    try {
      await fs.symlink(nestedDir, linkDir, "dir");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EPERM" || code === "EACCES") {
        return;
      }
      throw error;
    }

    const resolved = await assertSandboxPath({
      filePath: "linked/safe.txt",
      cwd: rootDir,
      root: rootDir,
    });

    expect(await fs.realpath(resolved.resolved)).toBe(await fs.realpath(targetFile));
    expect(resolved.relative.split(path.sep).join("/")).toBe("nested/safe.txt");
  });

  it("rejects symlink escapes outside the sandbox root", async () => {
    const rootDir = path.join(tmpDir, "root");
    const outsideDir = path.join(tmpDir, "outside");
    await fs.mkdir(rootDir, { recursive: true });
    await fs.mkdir(outsideDir, { recursive: true });
    await fs.writeFile(path.join(outsideDir, "secret.txt"), "secret", "utf8");
    const linkDir = path.join(rootDir, "linked");

    try {
      await fs.symlink(outsideDir, linkDir, "dir");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EPERM" || code === "EACCES") {
        return;
      }
      throw error;
    }

    await expect(
      assertSandboxPath({
        filePath: "linked/secret.txt",
        cwd: rootDir,
        root: rootDir,
      }),
    ).rejects.toThrow(/escapes sandbox root/i);
  });

  it("rejects dangling symlinks whose targets resolve outside the sandbox root", async () => {
    const rootDir = path.join(tmpDir, "root");
    const outsideDir = path.join(tmpDir, "outside");
    await fs.mkdir(rootDir, { recursive: true });
    await fs.mkdir(outsideDir, { recursive: true });
    const linkFile = path.join(rootDir, "escape.txt");

    try {
      await fs.symlink(path.join(outsideDir, "secret.txt"), linkFile, "file");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EPERM" || code === "EACCES") {
        return;
      }
      throw error;
    }

    await expect(
      assertSandboxPath({
        filePath: "escape.txt",
        cwd: rootDir,
        root: rootDir,
      }),
    ).rejects.toThrow(/escapes sandbox root/i);
  });

  it("rejects missing paths beneath nested symlink chains that escape the sandbox root", async () => {
    const rootDir = path.join(tmpDir, "root");
    const outsideDir = path.join(tmpDir, "outside");
    await fs.mkdir(rootDir, { recursive: true });
    await fs.mkdir(outsideDir, { recursive: true });
    const bridgeDir = path.join(rootDir, "bridge");
    const aliasDir = path.join(rootDir, "alias");

    try {
      await fs.symlink(outsideDir, bridgeDir, "dir");
      await fs.symlink(bridgeDir, aliasDir, "dir");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EPERM" || code === "EACCES") {
        return;
      }
      throw error;
    }

    await expect(
      assertSandboxPath({
        filePath: "alias/missing.txt",
        cwd: rootDir,
        root: rootDir,
      }),
    ).rejects.toThrow(/escapes sandbox root/i);
  });
});
