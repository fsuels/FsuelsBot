import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadJsonFile, saveJsonFile } from "./json-file.js";

describe("saveJsonFile", () => {
  let tempDir: string | null = null;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (tempDir) {
      await fsPromises.rm(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it("writes JSON via a temp file and removes temp files after success", async () => {
    tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "openclaw-json-"));
    const pathname = path.join(tempDir, "nested", "state.json");

    saveJsonFile(pathname, { ok: true, nested: { count: 1 } });

    expect(loadJsonFile(pathname)).toEqual({ ok: true, nested: { count: 1 } });

    const entries = await fsPromises.readdir(path.dirname(pathname));
    expect(entries.filter((entry) => entry.endsWith(".tmp"))).toEqual([]);
  });

  it("preserves the existing file and cleans up temp files when rename fails", async () => {
    tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "openclaw-json-"));
    const pathname = path.join(tempDir, "state.json");

    saveJsonFile(pathname, { ok: "before" });

    const renameSpy = vi.spyOn(fs, "renameSync").mockImplementation(() => {
      throw new Error("rename failed");
    });

    expect(() => saveJsonFile(pathname, { ok: "after" })).toThrow("rename failed");
    renameSpy.mockRestore();

    expect(loadJsonFile(pathname)).toEqual({ ok: "before" });

    const entries = await fsPromises.readdir(tempDir);
    expect(entries.filter((entry) => entry.endsWith(".tmp"))).toEqual([]);
  });
});
