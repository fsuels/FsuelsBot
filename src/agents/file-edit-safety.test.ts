import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { createFileEditStateTracker, FileToolError } from "./file-edit-safety.js";

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
});
