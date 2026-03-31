import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createFileEditStateTracker, FileToolError } from "./file-edit-safety.js";
import { createTransactionalEditTool } from "./transactional-edit-tool.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-edit-tool-"));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

describe("createTransactionalEditTool", () => {
  it("preserves untouched text when a fuzzy match normalizes punctuation", async () => {
    await withTempDir(async (dir) => {
      const target = path.join(dir, "quotes.txt");
      await fs.writeFile(target, 'greeting = “hello”\nother = “world”\n', "utf8");

      const stateTracker = createFileEditStateTracker();
      await stateTracker.recordRead({ filePath: "quotes.txt", cwd: dir });
      const tool = createTransactionalEditTool(dir, { stateTracker, cwd: dir });

      await tool.execute("edit-1", {
        path: "quotes.txt",
        oldText: 'greeting = "hello"',
        newText: 'greeting = "hi"',
      });

      expect(await fs.readFile(target, "utf8")).toBe('greeting = "hi"\nother = “world”\n');
    });
  });

  it("rejects partial edits inside protected placeholders", async () => {
    await withTempDir(async (dir) => {
      const target = path.join(dir, "template.txt");
      await fs.writeFile(target, "Hello {{UserName}}!\n", "utf8");

      const stateTracker = createFileEditStateTracker();
      await stateTracker.recordRead({ filePath: "template.txt", cwd: dir });
      const tool = createTransactionalEditTool(dir, { stateTracker, cwd: dir });

      await expect(
        tool.execute("edit-2", {
          path: "template.txt",
          oldText: "UserName",
          newText: "AccountName",
        }),
      ).rejects.toMatchObject<FileToolError>({
        errorCode: "invalid_edit_request",
      });
    });
  });

  it("rejects edits that split grapheme clusters", async () => {
    await withTempDir(async (dir) => {
      const target = path.join(dir, "emoji.txt");
      await fs.writeFile(target, "emoji = 👨‍👩‍👧‍👦\n", "utf8");

      const stateTracker = createFileEditStateTracker();
      await stateTracker.recordRead({ filePath: "emoji.txt", cwd: dir });
      const tool = createTransactionalEditTool(dir, { stateTracker, cwd: dir });

      await expect(
        tool.execute("edit-3", {
          path: "emoji.txt",
          oldText: "👩",
          newText: "X",
        }),
      ).rejects.toMatchObject<FileToolError>({
        errorCode: "invalid_edit_request",
      });
    });
  });
});
