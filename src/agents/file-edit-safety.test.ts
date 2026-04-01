import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it, vi } from "vitest";
import {
  createFileEditStateTracker,
  FileToolError,
  normalizeFileStateKey,
} from "./file-edit-safety.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-file-edit-safety-"));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function expectFileToolError(
  promise: Promise<unknown>,
  code: InstanceType<typeof FileToolError>["errorCode"],
) {
  try {
    await promise;
    throw new Error(`Expected FileToolError(${code})`);
  } catch (error) {
    expect(error).toBeInstanceOf(FileToolError);
    expect((error as FileToolError).errorCode).toBe(code);
  }
}

describe("createFileEditStateTracker", () => {
  it("normalizes Windows file-state keys case-insensitively", () => {
    expect(normalizeFileStateKey("C:\\Workspace\\Foo\\Bar.txt", { platform: "win32" })).toBe(
      "c:/workspace/foo/bar.txt",
    );
    expect(normalizeFileStateKey("c:/workspace/foo/bar.txt", { platform: "win32" })).toBe(
      "c:/workspace/foo/bar.txt",
    );
  });

  it("treats relative and absolute aliases as one tracked entry", async () => {
    await withTempDir(async (dir) => {
      const tracker = createFileEditStateTracker();
      const target = path.join(dir, "alias.txt");
      await fs.writeFile(target, "before\n", "utf8");

      await tracker.recordRead({ filePath: "alias.txt", cwd: dir });
      await tracker.recordRead({ filePath: target, cwd: dir });

      expect(tracker.snapshotReadStates()).toHaveLength(1);
      await tracker.writeTextDetailed("write", target, "after\n");
      expect(await fs.readFile(target, "utf8")).toBe("after\n");
    });
  });

  it("dedupes tracked state across symlink aliases", async () => {
    await withTempDir(async (dir) => {
      if (process.platform === "win32") {
        return;
      }

      const tracker = createFileEditStateTracker();
      const target = path.join(dir, "real.txt");
      const alias = path.join(dir, "linked.txt");
      await fs.writeFile(target, "before\n", "utf8");
      await fs.symlink(target, alias);

      await tracker.recordRead({ filePath: "real.txt", cwd: dir });
      await tracker.recordRead({ filePath: "linked.txt", cwd: dir });

      const snapshot = tracker.snapshotReadStates();
      expect(snapshot).toHaveLength(1);
      expect(path.basename(snapshot[0]?.path ?? "")).toBe("linked.txt");
    });
  });

  it("rejects writes to existing files that were not read first", async () => {
    await withTempDir(async (dir) => {
      const tracker = createFileEditStateTracker();
      const target = path.join(dir, "guarded.txt");
      await fs.writeFile(target, "before\n", "utf8");

      await expectFileToolError(
        tracker.writeTextDetailed("write", target, "after\n"),
        "file_not_read",
      );
      expect(await fs.readFile(target, "utf8")).toBe("before\n");
    });
  });

  it("supports exporting and seeding read provenance across tracker recreation", async () => {
    await withTempDir(async (dir) => {
      const target = path.join(dir, "seeded.txt");
      await fs.writeFile(target, "before\n", "utf8");

      const original = createFileEditStateTracker();
      await original.recordRead({ filePath: "seeded.txt", cwd: dir });

      // Simulate compaction/resume by restoring only the seedable read metadata.
      const restored = createFileEditStateTracker();
      for (const seed of original.snapshotReadStates()) {
        await restored.seedReadState({ ...seed, cwd: dir });
      }

      await restored.writeTextDetailed("write", target, "after\n");
      expect(await fs.readFile(target, "utf8")).toBe("after\n");
    });
  });

  it("rejects seeded provenance after the file changes", async () => {
    await withTempDir(async (dir) => {
      const target = path.join(dir, "stale-seed.txt");
      await fs.writeFile(target, "before\n", "utf8");

      const stat = await fs.stat(target);
      const tracker = createFileEditStateTracker();
      await tracker.seedReadState({
        path: "stale-seed.txt",
        cwd: dir,
        mtimeMs: stat.mtimeMs,
      });

      await delay(20);
      await fs.writeFile(target, "changed\n", "utf8");

      await expectFileToolError(
        tracker.writeTextDetailed("write", target, "after\n"),
        "file_changed_since_read",
      );
      expect(await fs.readFile(target, "utf8")).toBe("changed\n");
    });
  });

  it("evicts the least recently used read state when the cache is bounded", async () => {
    await withTempDir(async (dir) => {
      const tracker = createFileEditStateTracker({ maxEntries: 2 });
      const files = [
        ["one.txt", "one\n"],
        ["two.txt", "two\n"],
        ["three.txt", "three\n"],
      ] as const;

      for (const [name, contents] of files) {
        await fs.writeFile(path.join(dir, name), contents, "utf8");
      }

      await tracker.recordRead({ filePath: "one.txt", cwd: dir });
      await tracker.recordRead({ filePath: "two.txt", cwd: dir });
      await tracker.recordRead({ filePath: "one.txt", cwd: dir });
      await tracker.recordRead({ filePath: "three.txt", cwd: dir });

      expect(tracker.snapshotReadStates().map((entry) => path.basename(entry.path))).toEqual([
        "one.txt",
        "three.txt",
      ]);

      await expectFileToolError(
        tracker.writeTextDetailed("write", path.join(dir, "two.txt"), "updated two\n"),
        "file_not_read",
      );

      await tracker.writeTextDetailed("write", path.join(dir, "one.txt"), "updated one\n");
      expect(await fs.readFile(path.join(dir, "one.txt"), "utf8")).toBe("updated one\n");
    });
  });

  it("evicts older entries when the tracked byte budget is exceeded", async () => {
    await withTempDir(async (dir) => {
      const tracker = createFileEditStateTracker({ maxBytes: 10 });
      const first = path.join(dir, "first.txt");
      const second = path.join(dir, "second.txt");
      await fs.writeFile(first, "12345678", "utf8");
      await fs.writeFile(second, "abcdefgh", "utf8");

      await tracker.recordRead({ filePath: "first.txt", cwd: dir });
      await tracker.recordRead({ filePath: "second.txt", cwd: dir });

      expect(tracker.snapshotReadStates().map((entry) => path.basename(entry.path))).toEqual([
        "second.txt",
      ]);
    });
  });

  it("blocks writes after a partial read until the file is fully re-read", async () => {
    await withTempDir(async (dir) => {
      const tracker = createFileEditStateTracker();
      const target = path.join(dir, "partial.txt");
      await fs.writeFile(target, "alpha\nbeta\n", "utf8");

      await tracker.recordRead({ filePath: "partial.txt", cwd: dir, limit: 1 });
      await expectFileToolError(
        tracker.writeTextDetailed("write", target, "gamma\nbeta\n"),
        "partial_read_only",
      );

      await tracker.recordRead({ filePath: "partial.txt", cwd: dir });
      await tracker.writeTextDetailed("write", target, "gamma\nbeta\n");
      expect(await fs.readFile(target, "utf8")).toBe("gamma\nbeta\n");
    });
  });

  it("round-trips empty utf-8 files with emoji and CJK content", async () => {
    await withTempDir(async (dir) => {
      const tracker = createFileEditStateTracker();
      const target = path.join(dir, "unicode.txt");
      await fs.writeFile(target, "", "utf8");

      await tracker.recordRead({ filePath: "unicode.txt", cwd: dir });
      await tracker.writeTextDetailed("write", target, "hello 😀\n漢字\n");

      expect(await fs.readFile(target, "utf8")).toBe("hello 😀\n漢字\n");
    });
  });

  it("preserves CRLF line endings and file mode on write-back", async () => {
    await withTempDir(async (dir) => {
      const tracker = createFileEditStateTracker();
      const target = path.join(dir, "windows.txt");
      await fs.writeFile(target, "alpha\r\nbeta\r\n", "utf8");
      await fs.chmod(target, 0o744);

      await tracker.recordRead({ filePath: "windows.txt", cwd: dir });
      await tracker.writeTextDetailed("write", target, "alpha\ncharlie\n");

      expect(await fs.readFile(target, "utf8")).toBe("alpha\r\ncharlie\r\n");
      expect((await fs.stat(target)).mode & 0o777).toBe(0o744);
    });
  });

  it("writes through symlink targets without replacing the symlink", async () => {
    await withTempDir(async (dir) => {
      if (process.platform === "win32") {
        return;
      }

      const tracker = createFileEditStateTracker();
      const target = path.join(dir, "real.txt");
      const link = path.join(dir, "linked.txt");
      await fs.writeFile(target, "before\n", "utf8");
      await fs.symlink(target, link);

      await tracker.recordRead({ filePath: "linked.txt", cwd: dir });
      await tracker.writeTextDetailed("write", link, "after\n");

      expect(await fs.readFile(target, "utf8")).toBe("after\n");
      expect((await fs.lstat(link)).isSymbolicLink()).toBe(true);
    });
  });

  it("cleans up temp files when the atomic rename fails", async () => {
    await withTempDir(async (dir) => {
      const tracker = createFileEditStateTracker();
      const target = path.join(dir, "rename-fail.txt");
      await fs.writeFile(target, "before\n", "utf8");
      await tracker.recordRead({ filePath: "rename-fail.txt", cwd: dir });

      const renameSpy = vi
        .spyOn(fs, "rename")
        .mockRejectedValueOnce(Object.assign(new Error("blocked"), { code: "EPERM" }));
      try {
        await expectFileToolError(
          tracker.writeTextDetailed("write", target, "after\n"),
          "permission_denied",
        );
      } finally {
        renameSpy.mockRestore();
      }

      expect((await fs.readdir(dir)).filter((name) => name.startsWith(".openclaw-write-"))).toEqual(
        [],
      );
      expect(await fs.readFile(target, "utf8")).toBe("before\n");
    });
  });
});
