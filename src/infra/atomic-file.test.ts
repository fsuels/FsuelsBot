import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeTextFileAtomic, writeTextFileAtomicSync } from "./atomic-file.js";

const tempDirs: string[] = [];

async function makeTempDir() {
  const dir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "openclaw-atomic-file-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await fsPromises.rm(dir, { recursive: true, force: true });
    }),
  );
});

describe("atomic-file", () => {
  it("writes text files atomically", async () => {
    const dir = await makeTempDir();
    const target = path.join(dir, "notes.txt");
    await writeTextFileAtomic(target, "alpha\n");
    expect(await fsPromises.readFile(target, "utf-8")).toBe("alpha\n");
    expect((await fsPromises.readdir(dir)).toSorted()).toEqual(["notes.txt"]);
  });

  it("overwrites existing files atomically", async () => {
    const dir = await makeTempDir();
    const target = path.join(dir, "notes.txt");
    await fsPromises.writeFile(target, "before\n", "utf-8");
    await writeTextFileAtomic(target, "after\n");
    expect(await fsPromises.readFile(target, "utf-8")).toBe("after\n");
  });

  it("writes text files atomically in sync flows", async () => {
    const dir = await makeTempDir();
    const target = path.join(dir, "state.json");
    writeTextFileAtomicSync(target, "{\n}\n");
    expect(fs.readFileSync(target, "utf-8")).toBe("{\n}\n");
    expect(fs.readdirSync(dir).toSorted()).toEqual(["state.json"]);
  });
});
