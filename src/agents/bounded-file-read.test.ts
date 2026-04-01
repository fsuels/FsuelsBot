import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FileTooLargeError, readEditContext, readFileInRange } from "./bounded-file-read.js";

async function withTempDir<T>(prefix: string, fn: (dir: string) => Promise<T>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

describe("bounded-file-read", () => {
  it("strips a UTF-8 BOM and normalizes CRLF input", async () => {
    await withTempDir("openclaw-bounded-read-", async (dir) => {
      const filePath = path.join(dir, "bom-crlf.txt");
      await fs.writeFile(
        filePath,
        Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("a\r\nb\r\n")]),
      );

      const result = await readFileInRange(filePath, 0, 10, 1024, undefined, {
        truncateOnByteLimit: true,
      });

      expect(result.content).toBe("a\nb\n");
      expect(result.lineCount).toBe(3);
      expect(result.totalLines).toBe(3);
    });
  });

  it("supports range reads near EOF", async () => {
    await withTempDir("openclaw-bounded-read-", async (dir) => {
      const filePath = path.join(dir, "near-eof.txt");
      await fs.writeFile(filePath, "one\ntwo\nthree", "utf8");

      const result = await readFileInRange(filePath, 2, 10, 1024, undefined, {
        truncateOnByteLimit: true,
      });

      expect(result.content).toBe("three");
      expect(result.lineCount).toBe(1);
      expect(result.totalLines).toBe(3);
    });
  });

  it("uses the streaming path for large files", async () => {
    await withTempDir("openclaw-bounded-read-", async (dir) => {
      const filePath = path.join(dir, "large.txt");
      const line = "abcdefghijklmnopqrstuvwxyz0123456789\n";
      const repeats = Math.ceil((11 * 1024 * 1024) / Buffer.byteLength(line, "utf8"));
      await fs.writeFile(filePath, line.repeat(repeats), "utf8");

      const result = await readFileInRange(filePath, 0, 2, 4096, undefined, {
        truncateOnByteLimit: true,
      });

      expect(result.content.split("\n").slice(0, 2)).toEqual([
        "abcdefghijklmnopqrstuvwxyz0123456789",
        "abcdefghijklmnopqrstuvwxyz0123456789",
      ]);
      expect(result.totalBytes).toBeGreaterThan(10 * 1024 * 1024);
      expect(result.readBytes).toBeGreaterThan(10 * 1024 * 1024);
    });
  });

  it("marks oversized single-line reads as byte-truncated", async () => {
    await withTempDir("openclaw-bounded-read-", async (dir) => {
      const filePath = path.join(dir, "single-line.txt");
      await fs.writeFile(filePath, "x".repeat(8_192), "utf8");

      const result = await readFileInRange(filePath, 0, 1, 256, undefined, {
        truncateOnByteLimit: true,
      });

      expect(result.content).toBe("");
      expect(result.lineCount).toBe(0);
      expect(result.truncatedByBytes).toBe(true);
      expect(result.firstExcludedLineBytes).toBeGreaterThan(256);
    });
  });

  it("throws a typed error when byte truncation is disabled", async () => {
    await withTempDir("openclaw-bounded-read-", async (dir) => {
      const filePath = path.join(dir, "too-large.txt");
      await fs.writeFile(filePath, "x".repeat(2_048), "utf8");

      await expect(
        readFileInRange(filePath, 0, 1, 256, undefined, { truncateOnByteLimit: false }),
      ).rejects.toBeInstanceOf(FileTooLargeError);
    });
  });

  it("rejects aborted reads", async () => {
    await withTempDir("openclaw-bounded-read-", async (dir) => {
      const filePath = path.join(dir, "abort.txt");
      await fs.writeFile(filePath, "alpha\nbeta\n", "utf8");
      const controller = new AbortController();
      controller.abort();

      await expect(
        readFileInRange(filePath, 0, 10, 1024, controller.signal, {
          truncateOnByteLimit: true,
        }),
      ).rejects.toThrow(/aborted/i);
    });
  });

  it("rejects missing files", async () => {
    await withTempDir("openclaw-bounded-read-", async (dir) => {
      await expect(
        readFileInRange(path.join(dir, "missing.txt"), 0, 10, 1024, undefined, {
          truncateOnByteLimit: true,
        }),
      ).rejects.toThrow();
    });
  });

  it("rejects directory reads", async () => {
    await withTempDir("openclaw-bounded-read-", async (dir) => {
      await expect(
        readFileInRange(dir, 0, 10, 1024, undefined, { truncateOnByteLimit: true }),
      ).rejects.toThrow();
    });
  });

  it("finds edit context when the needle spans a stream chunk boundary", async () => {
    await withTempDir("openclaw-bounded-read-", async (dir) => {
      const filePath = path.join(dir, "chunk-boundary.txt");
      const prefix = "x".repeat(65_534);
      await fs.writeFile(filePath, `${prefix}MATCH-BOUNDARY\nnext line\nthird line`, "utf8");

      const result = await readEditContext(filePath, "MATCH-BOUNDARY\nnext", 1);

      expect(result).toBeTruthy();
      expect(result?.content).toContain("MATCH-BOUNDARY");
      expect(result?.content).toContain("next line");
    });
  });
});
