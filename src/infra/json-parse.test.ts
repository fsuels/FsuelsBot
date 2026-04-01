import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  __test,
  parseJsonLines,
  readJsonLinesTail,
  resetJsonParseCachesForTest,
  safeParseJson,
} from "./json-parse.js";

describe("json-parse", () => {
  afterEach(() => {
    resetJsonParseCachesForTest();
  });

  it("parses UTF-8 BOM-prefixed JSON", () => {
    expect(safeParseJson(`\uFEFF{"ok":true}`)).toEqual({ ok: true });
  });

  it("caches repeated invalid JSON and suppresses duplicate error callbacks", () => {
    const errors: string[] = [];
    const onError = (error: Error) => errors.push(error.message);

    expect(safeParseJson('{"broken"', { onError })).toBeUndefined();
    expect(safeParseJson('{"broken"', { onError })).toBeUndefined();

    expect(errors).toHaveLength(1);
    expect(__test.getJsonParseCacheSize()).toBe(1);
  });

  it("does not cache oversized JSON payloads", () => {
    const errors: string[] = [];
    const onError = (error: Error) => errors.push(error.message);
    const largeInvalid = `{"payload":"${"x".repeat(__test.MAX_CACHEABLE_JSON_BYTES)}"`;

    expect(safeParseJson(largeInvalid, { onError })).toBeUndefined();
    expect(safeParseJson(largeInvalid, { onError })).toBeUndefined();

    expect(errors).toHaveLength(1);
    expect(__test.getJsonParseCacheSize()).toBe(0);
  });

  it("parses JSONL while skipping malformed rows", () => {
    const result = parseJsonLines<{ id: number }>('{"id":1}\nnot-json\n{"id":2}\n', {
      skipMalformed: true,
    });

    expect(result.items).toEqual([{ id: 1 }, { id: 2 }]);
    expect(result.skipped).toBe(1);
  });

  it("reads only the newest complete JSONL tail rows", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-json-tail-"));
    const filePath = path.join(dir, "events.jsonl");
    const firstLine = JSON.stringify({ id: 1, text: "x".repeat(80) });
    const secondLine = JSON.stringify({ id: 2 });
    const thirdLine = JSON.stringify({ id: 3 });
    const raw = `${firstLine}\n${secondLine}\n${thirdLine}\n`;
    await fs.writeFile(filePath, raw, "utf8");

    const tailBytes = Buffer.byteLength(`xxxxx\n${secondLine}\n${thirdLine}\n`, "utf8");
    const result = readJsonLinesTail<{ id: number }>(filePath, tailBytes, {
      skipMalformed: true,
    });

    expect(result.items).toEqual([{ id: 2 }, { id: 3 }]);
    expect(result.skipped).toBe(0);
    await fs.rm(dir, { recursive: true, force: true });
  });
});
