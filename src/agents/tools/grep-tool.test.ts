import {
  spawn,
  type ChildProcessWithoutNullStreams,
  type SpawnOptionsWithoutStdio,
} from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { executeToolWithContract } from "../tool-contract.js";
import { createGrepTool, resolveGrepTimeoutMs } from "./grep-tool.js";

async function withTempDir<T>(prefix: string, fn: (dir: string) => Promise<T>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function invokeTool(tool: ReturnType<typeof createGrepTool>, rawInput: unknown) {
  return await executeToolWithContract({
    tool: tool as never,
    rawInput,
    context: {
      toolCallId: "grep-call",
      source: "embedded",
    },
    invoke: async (input) => await tool.execute("grep-call", input),
  });
}

function getText(result: { content?: Array<{ type?: string; text?: string }> }) {
  return result.content?.find((block) => block.type === "text")?.text ?? "";
}

function getDetails(result: { details?: unknown }) {
  return result.details as {
    searchStatus: string;
    outputMode: string;
    totalFilesFound: number;
    totalMatchesFound: number;
    returnedFiles: number;
    returnedLines: number;
    hasMore: boolean;
    nextOffset: number | null;
    appliedLimit?: number;
    appliedOffset?: number;
    content?: string;
    filenames?: string[];
    countLines?: string[];
    numLines?: number;
    numFiles?: number;
    numMatches?: number;
  };
}

function spawnNodeScript(
  script: string,
  options: SpawnOptionsWithoutStdio,
): ChildProcessWithoutNullStreams {
  return spawn(process.execPath, ["-e", script], {
    ...options,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

describe("grep-tool", () => {
  it("supports patterns that start with '-'", async () => {
    await withTempDir("openclaw-grep-", async (dir) => {
      await fs.writeFile(path.join(dir, "flags.txt"), "-alpha\nbeta\n", "utf8");
      const tool = createGrepTool({ cwd: dir });

      const result = await invokeTool(tool, {
        pattern: "-alpha",
        output_mode: "content",
      });

      expect(getText(result)).toContain("flags.txt:1:-alpha");
      expect(getDetails(result).totalMatchesFound).toBe(1);
    });
  });

  it("requires multiline=true for cross-line regex and succeeds when enabled", async () => {
    await withTempDir("openclaw-grep-", async (dir) => {
      await fs.writeFile(path.join(dir, "multiline.txt"), "foo\nbar\n", "utf8");
      const tool = createGrepTool({ cwd: dir });

      await expect(
        invokeTool(tool, {
          pattern: "foo\nbar",
          output_mode: "content",
        }),
      ).rejects.toThrow(/multiline=true/);

      const result = await invokeTool(tool, {
        pattern: "foo\nbar",
        output_mode: "content",
        multiline: true,
      });

      const text = getText(result);
      expect(text).toContain("multiline.txt:1:foo");
      expect(text).toContain("multiline.txt:2:bar");
      expect(getDetails(result).totalMatchesFound).toBe(1);
    });
  });

  it("defaults to head_limit=250 in content mode and signals next pagination step", async () => {
    await withTempDir("openclaw-grep-", async (dir) => {
      const lines = Array.from({ length: 260 }, (_, index) => `match ${index + 1}`).join("\n");
      await fs.writeFile(path.join(dir, "many.txt"), `${lines}\n`, "utf8");
      const tool = createGrepTool({ cwd: dir });

      const result = await invokeTool(tool, {
        pattern: "match",
        output_mode: "content",
      });

      const details = getDetails(result);
      expect(details.numLines).toBe(250);
      expect(details.hasMore).toBe(true);
      expect(details.nextOffset).toBe(250);
      expect(details.appliedLimit).toBe(250);
      expect(getText(result)).toContain("next offset 250");
    });
  });

  it("paginates content mode with offset/head_limit and coerces numeric strings", async () => {
    await withTempDir("openclaw-grep-", async (dir) => {
      const lines = Array.from({ length: 5 }, (_, index) => `match ${index + 1}`).join("\n");
      await fs.writeFile(path.join(dir, "paged.txt"), `${lines}\n`, "utf8");
      const tool = createGrepTool({ cwd: dir });

      const result = await invokeTool(tool, {
        pattern: "match",
        output_mode: "content",
        offset: "2",
        head_limit: "2",
      });

      const details = getDetails(result);
      expect(details.numLines).toBe(2);
      expect(details.appliedOffset).toBe(2);
      expect(details.hasMore).toBe(true);
      expect(details.nextOffset).toBe(4);
      expect(details.content).toContain("paged.txt:3:match 3");
      expect(details.content).toContain("paged.txt:4:match 4");
    });
  });

  it("coerces boolean-like strings and rejects unknown input fields", async () => {
    await withTempDir("openclaw-grep-", async (dir) => {
      await fs.writeFile(path.join(dir, "flags.txt"), "alpha\n", "utf8");
      const tool = createGrepTool({ cwd: dir });

      const result = await invokeTool(tool, {
        pattern: "alpha",
        output_mode: "content",
        show_line_numbers: "false",
      });

      expect(getDetails(result).content).toContain("flags.txt:alpha");
      expect(getDetails(result).content).not.toContain("flags.txt:1:alpha");

      await expect(
        invokeTool(tool, {
          pattern: "alpha",
          nope: true,
        }),
      ).rejects.toThrow(/Validation failed/);
    });
  });

  it("treats head_limit=0 as unlimited", async () => {
    await withTempDir("openclaw-grep-", async (dir) => {
      const lines = Array.from({ length: 260 }, (_, index) => `match ${index + 1}`).join("\n");
      await fs.writeFile(path.join(dir, "all.txt"), `${lines}\n`, "utf8");
      const tool = createGrepTool({ cwd: dir });

      const result = await invokeTool(tool, {
        pattern: "match",
        output_mode: "content",
        head_limit: 0,
      });

      const details = getDetails(result);
      expect(details.numLines).toBe(260);
      expect(details.hasMore).toBe(false);
      expect(details.nextOffset).toBeNull();
      expect(details.appliedLimit).toBeUndefined();
    });
  });

  it("supports content, files_with_matches, and count modes", async () => {
    await withTempDir("openclaw-grep-", async (dir) => {
      await fs.mkdir(path.join(dir, "src"), { recursive: true });
      await fs.writeFile(path.join(dir, "src", "a.ts"), "alpha\n", "utf8");
      await fs.writeFile(path.join(dir, "src", "b.ts"), "beta alpha\n", "utf8");
      await fs.utimes(path.join(dir, "src", "a.ts"), new Date(2_000), new Date(2_000));
      await fs.utimes(path.join(dir, "src", "b.ts"), new Date(1_000), new Date(1_000));
      const tool = createGrepTool({ cwd: dir });

      const content = await invokeTool(tool, {
        pattern: "alpha",
        output_mode: "content",
      });
      const files = await invokeTool(tool, {
        pattern: "alpha",
        head_limit: 1,
      });
      const count = await invokeTool(tool, {
        pattern: "alpha",
        output_mode: "count",
        head_limit: 1,
      });

      expect(getDetails(content).outputMode).toBe("content");
      expect(getDetails(content).numLines).toBe(2);
      expect(getDetails(files).outputMode).toBe("files_with_matches");
      expect(getDetails(files).filenames).toEqual(["src/a.ts"]);
      expect(getText(files)).toContain("next offset 1");
      expect(getDetails(count).outputMode).toBe("count");
      expect(getDetails(count).countLines).toHaveLength(1);
      expect(["src/a.ts:1", "src/b.ts:1"]).toContain(getDetails(count).countLines?.[0]);
      expect(getText(count)).toContain("next offset 1");
    });
  });

  it("returns a helpful missing path error", async () => {
    await withTempDir("openclaw-grep-", async (dir) => {
      const tool = createGrepTool({ cwd: dir });
      await expect(
        invokeTool(tool, {
          pattern: "alpha",
          path: "missing",
        }),
      ).rejects.toThrow(/Path not found/);
    });
  });

  it("includes hidden files but excludes VCS directories by default", async () => {
    await withTempDir("openclaw-grep-", async (dir) => {
      await fs.mkdir(path.join(dir, ".git"), { recursive: true });
      await fs.writeFile(path.join(dir, ".hidden.txt"), "alpha\n", "utf8");
      await fs.writeFile(path.join(dir, ".git", "secret.txt"), "alpha\n", "utf8");
      const tool = createGrepTool({ cwd: dir });

      const result = await invokeTool(tool, {
        pattern: "alpha",
      });

      expect(getDetails(result).filenames).toEqual([".hidden.txt"]);
    });
  });

  it("does not crash when a file disappears during mtime ranking", async () => {
    await withTempDir("openclaw-grep-", async (dir) => {
      await fs.writeFile(path.join(dir, "a.txt"), "alpha\n", "utf8");
      await fs.writeFile(path.join(dir, "b.txt"), "alpha\n", "utf8");
      const tool = createGrepTool({
        cwd: dir,
        operations: {
          stat: async (filePath) => {
            if (filePath.endsWith("b.txt")) {
              throw new Error("gone");
            }
            return await fs.stat(filePath);
          },
        },
      });

      const result = await invokeTool(tool, {
        pattern: "alpha",
      });

      expect(getDetails(result).filenames).toEqual(expect.arrayContaining(["a.txt", "b.txt"]));
    });
  });

  it("returns paths relative to the workspace root", async () => {
    await withTempDir("openclaw-grep-", async (dir) => {
      await fs.mkdir(path.join(dir, "nested"), { recursive: true });
      await fs.writeFile(path.join(dir, "nested", "a.txt"), "alpha\n", "utf8");
      const tool = createGrepTool({ cwd: dir });

      const result = await invokeTool(tool, {
        pattern: "alpha",
      });

      const details = getDetails(result);
      expect(details.filenames).toEqual(["nested/a.txt"]);
      expect(getText(result)).not.toContain(dir);
    });
  });

  it("keeps count totals correct under pagination", async () => {
    await withTempDir("openclaw-grep-", async (dir) => {
      await fs.writeFile(path.join(dir, "a.txt"), "alpha\nalpha\n", "utf8");
      await fs.writeFile(path.join(dir, "b.txt"), "alpha\n", "utf8");
      await fs.writeFile(path.join(dir, "c.txt"), "alpha\n", "utf8");
      const tool = createGrepTool({ cwd: dir });

      const result = await invokeTool(tool, {
        pattern: "alpha",
        output_mode: "count",
        offset: 1,
        head_limit: 1,
      });

      const details = getDetails(result);
      expect(details.totalMatchesFound).toBe(4);
      expect(details.totalFilesFound).toBe(3);
      expect(details.returnedLines).toBe(1);
      expect(details.hasMore).toBe(true);
      expect(details.nextOffset).toBe(2);
      expect(details.appliedOffset).toBe(1);
      expect(getText(result)).toContain("next offset 2");
    });
  });

  it("returns an explicit no_match status instead of pretending a timeout was empty", async () => {
    await withTempDir("openclaw-grep-", async (dir) => {
      await fs.writeFile(path.join(dir, "a.txt"), "alpha\n", "utf8");
      const tool = createGrepTool({ cwd: dir });

      const result = await invokeTool(tool, {
        pattern: "does-not-exist",
      });

      expect(getDetails(result).searchStatus).toBe("no_match");
      expect(getText(result)).toBe("No matches found.");
    });
  });

  it("throws when ripgrep times out before any complete lines are emitted", async () => {
    await withTempDir("openclaw-grep-", async (dir) => {
      const tool = createGrepTool({
        cwd: dir,
        timeoutMs: 20,
        operations: {
          spawn: (_command, _args, options) =>
            spawnNodeScript(
              "process.stdout.write('slow.txt\\0'); setTimeout(() => process.exit(0), 100);",
              options,
            ),
        },
      });

      await expect(
        invokeTool(tool, {
          pattern: "alpha",
        }),
      ).rejects.toThrow(/timed out/i);
    });
  });

  it("returns partial_timeout when complete lines were captured before timeout", async () => {
    await withTempDir("openclaw-grep-", async (dir) => {
      const tool = createGrepTool({
        cwd: dir,
        timeoutMs: 200,
        operations: {
          spawn: (_command, _args, options) =>
            spawnNodeScript(
              "process.stdout.write('a.txt\\u00001\\n'); setTimeout(() => process.stdout.write('b.txt\\u00001\\n'), 400); setTimeout(() => process.exit(0), 460);",
              options,
            ),
        },
      });

      const result = await invokeTool(tool, {
        pattern: "alpha",
      });

      expect(getDetails(result).searchStatus).toBe("partial_timeout");
      expect(getDetails(result).filenames).toEqual(["a.txt"]);
      expect(getText(result)).toContain("partial results");
    });
  });

  it("retries once with -j 1 on EAGAIN spawn failures", async () => {
    await withTempDir("openclaw-grep-", async (dir) => {
      const calls: string[][] = [];
      let attempts = 0;
      const tool = createGrepTool({
        cwd: dir,
        operations: {
          spawn: (_command, args, options) => {
            calls.push(args);
            attempts += 1;
            if (attempts === 1) {
              const error = new Error("resource temporarily unavailable") as Error & {
                code?: string;
              };
              error.code = "EAGAIN";
              throw error;
            }
            return spawnNodeScript("process.stdout.write('a.txt\\u00001\\n');", options);
          },
        },
      });

      const result = await invokeTool(tool, {
        pattern: "alpha",
      });

      expect(getDetails(result).filenames).toEqual(["a.txt"]);
      expect(calls[1]?.slice(0, 2)).toEqual(["-j", "1"]);
    });
  });

  it("keeps complete lines intact when stdout chunks split them", async () => {
    await withTempDir("openclaw-grep-", async (dir) => {
      const tool = createGrepTool({
        cwd: dir,
        operations: {
          spawn: (_command, _args, options) =>
            spawnNodeScript(
              "process.stdout.write('split.txt\\u0000'); setTimeout(() => process.stdout.write('1\\n'), 5); setTimeout(() => process.exit(0), 10);",
              options,
            ),
        },
      });

      const result = await invokeTool(tool, {
        pattern: "alpha",
        output_mode: "count",
      });

      expect(getDetails(result).countLines).toEqual(["split.txt:1"]);
    });
  });

  it("returns partial_timeout when the buffered output budget is exceeded", async () => {
    await withTempDir("openclaw-grep-", async (dir) => {
      const tool = createGrepTool({
        cwd: dir,
        maxBufferBytes: 16,
        operations: {
          spawn: (_command, _args, options) =>
            spawnNodeScript(
              "process.stdout.write('a.txt\\u00001\\n'); process.stdout.write('very-long-file-name.txt\\u00001\\n');",
              options,
            ),
        },
      });

      const result = await invokeTool(tool, {
        pattern: "alpha",
      });

      expect(getDetails(result).searchStatus).toBe("partial_timeout");
      expect(getDetails(result).filenames).toEqual(["a.txt"]);
    });
  });

  it("uses a longer default timeout on slow filesystem environments", () => {
    expect(resolveGrepTimeoutMs({}, () => true)).toBeGreaterThan(
      resolveGrepTimeoutMs({}, () => false),
    );
  });
});
