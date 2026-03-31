import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyPatch, createApplyPatchTool } from "./apply-patch.js";
import { createFileEditStateTracker, FileToolError } from "./file-edit-safety.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-patch-"));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

describe("applyPatch", () => {
  it("adds a file", async () => {
    await withTempDir(async (dir) => {
      const patch = `*** Begin Patch
*** Add File: hello.txt
+hello
*** End Patch`;

      const result = await applyPatch(patch, { cwd: dir });
      const contents = await fs.readFile(path.join(dir, "hello.txt"), "utf8");

      expect(contents).toBe("hello\n");
      expect(result.summary.added).toEqual(["hello.txt"]);
    });
  });

  it("updates and moves a file", async () => {
    await withTempDir(async (dir) => {
      const source = path.join(dir, "source.txt");
      await fs.writeFile(source, "foo\nbar\n", "utf8");

      const patch = `*** Begin Patch
*** Update File: source.txt
*** Move to: dest.txt
@@
 foo
-bar
+baz
*** End Patch`;

      const result = await applyPatch(patch, { cwd: dir });
      const dest = path.join(dir, "dest.txt");
      const contents = await fs.readFile(dest, "utf8");

      expect(contents).toBe("foo\nbaz\n");
      await expect(fs.stat(source)).rejects.toBeDefined();
      expect(result.summary.modified).toEqual(["dest.txt"]);
    });
  });

  it("supports end-of-file inserts", async () => {
    await withTempDir(async (dir) => {
      const target = path.join(dir, "end.txt");
      await fs.writeFile(target, "line1\n", "utf8");

      const patch = `*** Begin Patch
*** Update File: end.txt
@@
+line2
*** End of File
*** End Patch`;

      await applyPatch(patch, { cwd: dir });
      const contents = await fs.readFile(target, "utf8");
      expect(contents).toBe("line1\nline2\n");
    });
  });

  it("preserves BOM and CRLF when updating a file", async () => {
    await withTempDir(async (dir) => {
      const target = path.join(dir, "bom-crlf.txt");
      await fs.writeFile(target, Buffer.from([0xef, 0xbb, 0xbf]));
      await fs.appendFile(target, "alpha\r\nbeta\r\n", "utf8");

      const patch = `*** Begin Patch
*** Update File: bom-crlf.txt
@@
 alpha
-beta
+gamma
*** End Patch`;

      await applyPatch(patch, { cwd: dir });
      const contents = await fs.readFile(target);

      expect(contents.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
      expect(contents.subarray(3).toString("utf8")).toBe("alpha\r\ngamma\r\n");
    });
  });

  it("rejects updating an existing file that was not read first", async () => {
    await withTempDir(async (dir) => {
      const target = path.join(dir, "guarded.txt");
      await fs.writeFile(target, "before\n", "utf8");

      const stateTracker = createFileEditStateTracker();
      const tool = createApplyPatchTool({ cwd: dir, stateTracker });

      const patch = `*** Begin Patch
*** Update File: guarded.txt
@@
-before
+after
*** End Patch`;

      const result = await tool.execute("patch-guard", { input: patch });
      expect(
        result?.details && typeof result.details === "object" && "error_code" in result.details
          ? (result.details as { error_code?: unknown }).error_code
          : undefined,
      ).toBe("file_not_read");

      await stateTracker.recordRead({ filePath: "guarded.txt", cwd: dir });
      const success = await tool.execute("patch-ok", { input: patch });
      const contents = await fs.readFile(target, "utf8");

      expect(
        success?.details && typeof success.details === "object" && "summary" in success.details,
      ).toBe(true);
      expect(contents).toBe("after\n");
    });
  });

  it("rejects partial updates inside multiline protected placeholders", async () => {
    await withTempDir(async (dir) => {
      const target = path.join(dir, "template.txt");
      await fs.writeFile(target, "before\n{{User\nName}}\nafter\n", "utf8");

      const patch = `*** Begin Patch
*** Update File: template.txt
@@ {{User
-Name}}
+FullName}}
*** End Patch`;

      await expect(applyPatch(patch, { cwd: dir })).rejects.toMatchObject<FileToolError>({
        errorCode: "invalid_edit_request",
      });
    });
  });
});
