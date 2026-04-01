import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import { Static, Type } from "@sinclair/typebox";
import { spawn, type ChildProcess, type SpawnOptionsWithoutStdio } from "node:child_process";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import type { AnyAgentTool } from "./common.js";
import { isWSLEnv } from "../../infra/wsl.js";
import { resolveAgentRuntimeCwd } from "../runtime-context.js";
import { assertSandboxPath } from "../sandbox-paths.js";
import { stringEnum } from "../schema/typebox.js";
import { defineOpenClawTool } from "../tool-contract.js";

const GREP_OUTPUT_MODES = ["content", "files_with_matches", "count"] as const;
const GREP_SEARCH_STATUSES = ["matches", "no_match", "partial_timeout"] as const;
const DEFAULT_HEAD_LIMIT = 250;
const MAX_COLUMNS = 500;
const MTIME_SORT_CAP = 50;
const DEFAULT_TIMEOUT_MS = 6_000;
const DEFAULT_TIMEOUT_MS_WSL = 12_000;
const DEFAULT_MAX_BUFFER_BYTES = 512 * 1024;
const VCS_EXCLUDE_GLOBS = [
  "!.git",
  "!.git/**",
  "!.svn",
  "!.svn/**",
  "!.hg",
  "!.hg/**",
  "!.bzr",
  "!.bzr/**",
  "!.jj",
  "!.jj/**",
  "!.sl",
  "!.sl/**",
] as const;

const GrepToolInputSchema = Type.Object(
  {
    pattern: Type.String({
      description:
        "Regex pattern to search for. Prefer this tool over shell rg/grep for repo search.",
    }),
    path: Type.Optional(
      Type.String({
        description: "Directory or file to search. Defaults to the current workspace root.",
      }),
    ),
    glob: Type.Optional(
      Type.String({
        description: "Optional file glob filter, for example '*.{ts,tsx}' or 'src/**'.",
      }),
    ),
    type: Type.Optional(
      Type.String({
        description: "Optional ripgrep file type filter, for example 'ts' or 'md'.",
      }),
    ),
    output_mode: Type.Optional(
      stringEnum(GREP_OUTPUT_MODES, {
        description:
          "Search output mode. Use files_with_matches for filenames, count for per-file counts, or content for matching lines.",
        default: "files_with_matches",
      }),
    ),
    context_before: Type.Optional(
      Type.Integer({
        minimum: 0,
        description: "Lines of leading context for content mode.",
      }),
    ),
    context_after: Type.Optional(
      Type.Integer({
        minimum: 0,
        description: "Lines of trailing context for content mode.",
      }),
    ),
    context: Type.Optional(
      Type.Integer({
        minimum: 0,
        description:
          "Symmetric context for content mode. Overridden by context_before/context_after.",
      }),
    ),
    show_line_numbers: Type.Optional(
      Type.Boolean({
        description: "Show line numbers in content mode. Defaults to true.",
      }),
    ),
    case_insensitive: Type.Optional(
      Type.Boolean({
        description: "Case-insensitive search. Defaults to false.",
      }),
    ),
    head_limit: Type.Optional(
      Type.Integer({
        minimum: 0,
        description:
          "Maximum returned entries. Defaults to 250. In content mode this limits output lines. Use 0 for unlimited.",
      }),
    ),
    offset: Type.Optional(
      Type.Integer({
        minimum: 0,
        description:
          "Pagination offset. Applies to filenames/count lines/content lines depending on mode.",
      }),
    ),
    multiline: Type.Optional(
      Type.Boolean({
        description:
          "Enable multiline regex search. Defaults to false because it is more expensive.",
      }),
    ),
  },
  { additionalProperties: false },
);

const GrepToolOutputSchema = Type.Object({
  ok: Type.Boolean(),
  searchStatus: stringEnum(GREP_SEARCH_STATUSES),
  outputMode: stringEnum(GREP_OUTPUT_MODES),
  totalFilesFound: Type.Integer({ minimum: 0 }),
  totalMatchesFound: Type.Integer({ minimum: 0 }),
  returnedFiles: Type.Integer({ minimum: 0 }),
  returnedLines: Type.Integer({ minimum: 0 }),
  hasMore: Type.Boolean(),
  nextOffset: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
  appliedLimit: Type.Optional(Type.Integer({ minimum: 0 })),
  appliedOffset: Type.Optional(Type.Integer({ minimum: 0 })),
  content: Type.Optional(Type.String()),
  filenames: Type.Optional(Type.Array(Type.String())),
  countLines: Type.Optional(Type.Array(Type.String())),
  numLines: Type.Optional(Type.Integer({ minimum: 0 })),
  numFiles: Type.Optional(Type.Integer({ minimum: 0 })),
  numMatches: Type.Optional(Type.Integer({ minimum: 0 })),
});

type GrepToolInput = Static<typeof GrepToolInputSchema>;
type GrepToolDetails = Static<typeof GrepToolOutputSchema>;
type GrepSearchStatus = (typeof GREP_SEARCH_STATUSES)[number];

type MinimalStats = {
  isDirectory(): boolean;
  mtimeMs: number;
};

export type GrepToolOperations = {
  spawn: (command: string, args: string[], options: SpawnOptionsWithoutStdio) => ChildProcess;
  stat: (filePath: string) => Promise<MinimalStats>;
};

type SearchTarget = {
  resolvedPath: string;
  cwd: string;
  target: string;
  isDirectory: boolean;
};

type CountEntry = {
  file: string;
  count: number;
};

type CountScanResult = {
  searchStatus: GrepSearchStatus;
  totalFilesFound: number;
  totalMatchesFound: number;
  entries: CountEntry[];
};

type ContentScanResult = {
  searchStatus: GrepSearchStatus;
  rawLines: string[];
  uniqueFiles: Set<string>;
  hasMore: boolean;
};

type RipgrepRunResult = {
  searchStatus: GrepSearchStatus;
  emittedLines: number;
};

type RipgrepTimeoutSource = "timeout" | "max_buffer";

class SearchTimeoutError extends Error {
  readonly code = "SEARCH_TIMEOUT";
  readonly source: RipgrepTimeoutSource;

  constructor(message: string, source: RipgrepTimeoutSource) {
    super(message);
    this.name = "SearchTimeoutError";
    this.source = source;
  }
}

const defaultOperations: GrepToolOperations = {
  spawn: (command, args, options) =>
    spawn(command, args, {
      ...options,
      stdio: ["ignore", "pipe", "pipe"],
    }),
  stat: async (filePath) => await fs.stat(filePath),
};

let ripgrepHealthCache: Promise<void> | null = null;

function isEagainError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const record = error as { code?: unknown; message?: unknown };
  return (
    record.code === "EAGAIN" ||
    (typeof record.message === "string" &&
      record.message.toLowerCase().includes("resource temporarily unavailable"))
  );
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function resolveGrepTimeoutMs(
  env: NodeJS.ProcessEnv = process.env,
  isSlowFs = isWSLEnv,
): number {
  return (
    parsePositiveInteger(env.OPENCLAW_GREP_TIMEOUT_MS) ??
    parsePositiveInteger(env.OPENCLAW_RG_TIMEOUT_MS) ??
    (isSlowFs() ? DEFAULT_TIMEOUT_MS_WSL : DEFAULT_TIMEOUT_MS)
  );
}

function resolveGrepMaxBufferBytes(env: NodeJS.ProcessEnv = process.env): number {
  return (
    parsePositiveInteger(env.OPENCLAW_GREP_MAX_BUFFER_BYTES) ??
    parsePositiveInteger(env.OPENCLAW_RG_MAX_BUFFER_BYTES) ??
    DEFAULT_MAX_BUFFER_BYTES
  );
}

async function ensureRipgrepHealthy(operations: GrepToolOperations): Promise<void> {
  if (operations !== defaultOperations) {
    return;
  }
  if (!ripgrepHealthCache) {
    ripgrepHealthCache = new Promise<void>((resolve, reject) => {
      let child: ChildProcess;
      try {
        child = operations.spawn("rg", ["--version"], { cwd: resolveAgentRuntimeCwd() });
      } catch (error) {
        reject(error);
        return;
      }

      let stderr = "";
      child.stderr?.on("data", (chunk: Buffer | string) => {
        stderr += chunk.toString("utf8");
      });
      child.on("error", reject);
      child.on("close", (code: number | null) => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error(stderr.trim() || `ripgrep health check failed with code ${String(code)}`));
      });
    }).catch((error) => {
      ripgrepHealthCache = null;
      throw error;
    });
  }
  await ripgrepHealthCache;
}

function expandUserPath(filePath: string): string {
  if (filePath === "~") {
    return os.homedir();
  }
  if (filePath.startsWith("~/") || filePath.startsWith("~\\")) {
    return path.join(os.homedir(), filePath.slice(2));
  }
  return filePath;
}

function isNetworkPath(filePath: string): boolean {
  return filePath.startsWith("\\\\") || /^\/\/[^/]/.test(filePath);
}

function cleanRelativePath(filePath: string): string {
  const normalized = filePath.split("\u0000").join("").trim().replace(/\\/g, "/");
  if (normalized === "." || normalized === "./") {
    return ".";
  }
  return normalized.replace(/^\.\//, "");
}

function normalizeContentLine(line: string): string {
  const nulIndex = line.indexOf("\0");
  if (nulIndex === -1) {
    return line;
  }
  const rawFile = cleanRelativePath(line.slice(0, nulIndex));
  const rest = line.slice(nulIndex + 1);
  if (!rest) {
    return rawFile;
  }
  const numbered = /^(\d+)([:-])(.*)$/.exec(rest);
  if (numbered) {
    return `${rawFile}${numbered[2]}${rest}`;
  }
  return `${rawFile}:${rest}`;
}

function extractRawLineFile(line: string): string | null {
  const nulIndex = line.indexOf("\0");
  if (nulIndex === -1) {
    return null;
  }
  const file = cleanRelativePath(line.slice(0, nulIndex));
  return file || null;
}

function parseCountLine(line: string): CountEntry | null {
  const nulIndex = line.indexOf("\0");
  if (nulIndex === -1) {
    return null;
  }
  const file = cleanRelativePath(line.slice(0, nulIndex));
  const rawCount = line.slice(nulIndex + 1).trim();
  const count = Number.parseInt(rawCount, 10);
  if (!file || !Number.isFinite(count)) {
    return null;
  }
  return { file, count };
}

function resolveSearchTarget(cwd: string, requestedPath?: string): SearchTarget {
  const raw = expandUserPath(requestedPath?.trim() || ".");
  if (isNetworkPath(raw)) {
    throw new Error(`Network paths are not supported by grep: ${raw}`);
  }
  const resolvedPath = path.isAbsolute(raw) ? path.normalize(raw) : path.resolve(cwd, raw);
  if (isNetworkPath(resolvedPath)) {
    throw new Error(`Network paths are not supported by grep: ${raw}`);
  }
  return {
    resolvedPath,
    cwd: resolvedPath,
    target: ".",
    isDirectory: true,
  };
}

async function statSearchTarget(
  target: SearchTarget,
  operations: GrepToolOperations,
): Promise<SearchTarget> {
  let stat: MinimalStats;
  try {
    stat = await operations.stat(target.resolvedPath);
  } catch {
    throw new Error(`Path not found: ${target.resolvedPath}`);
  }
  if (stat.isDirectory()) {
    return target;
  }
  return {
    resolvedPath: target.resolvedPath,
    cwd: path.dirname(target.resolvedPath),
    target: path.basename(target.resolvedPath),
    isDirectory: false,
  };
}

function buildCommonArgs(input: GrepToolInput): string[] {
  const args = [
    "--color=never",
    "--hidden",
    "--no-messages",
    "--max-columns",
    String(MAX_COLUMNS),
    "--max-columns-preview",
  ];

  if (input.case_insensitive) {
    args.push("--ignore-case");
  }
  if (input.multiline) {
    args.push("--multiline", "--multiline-dotall");
  }
  if (input.type?.trim()) {
    args.push("--type", input.type.trim());
  }
  if (input.glob?.trim()) {
    args.push("--glob", input.glob.trim());
  }
  for (const glob of VCS_EXCLUDE_GLOBS) {
    args.push("--glob", glob);
  }
  args.push("-e", input.pattern);
  return args;
}

function buildCountArgs(input: GrepToolInput, target: SearchTarget): string[] {
  return [...buildCommonArgs(input), "--count-matches", "--with-filename", "--null", target.target];
}

function buildContentArgs(input: GrepToolInput, target: SearchTarget): string[] {
  const args = [...buildCommonArgs(input), "--with-filename", "--null", "--no-heading"];
  const showLineNumbers = input.show_line_numbers ?? true;
  if (showLineNumbers) {
    args.push("--line-number");
  }

  const contextBefore = input.context_before ?? input.context ?? 0;
  const contextAfter = input.context_after ?? input.context ?? 0;
  if (contextBefore === contextAfter && contextBefore > 0) {
    args.push("-C", String(contextBefore));
  } else {
    if (contextBefore > 0) {
      args.push("-B", String(contextBefore));
    }
    if (contextAfter > 0) {
      args.push("-A", String(contextAfter));
    }
  }

  args.push(target.target);
  return args;
}

async function runCountScan(params: {
  args: string[];
  cwd: string;
  signal?: AbortSignal;
  operations: GrepToolOperations;
  timeoutMs: number;
  maxBufferBytes: number;
}): Promise<CountScanResult> {
  const entries: CountEntry[] = [];
  let totalFilesFound = 0;
  let totalMatchesFound = 0;
  const result = await runRipgrepLines({
    args: params.args,
    cwd: params.cwd,
    signal: params.signal,
    operations: params.operations,
    timeoutMs: params.timeoutMs,
    maxBufferBytes: params.maxBufferBytes,
    onLine: (line) => {
      const entry = parseCountLine(line);
      if (!entry) {
        return "continue";
      }
      totalFilesFound += 1;
      totalMatchesFound += entry.count;
      entries.push(entry);
      return "continue";
    },
  });
  return {
    searchStatus: result.searchStatus,
    totalFilesFound,
    totalMatchesFound,
    entries,
  };
}

async function runRipgrepLines(params: {
  args: string[];
  cwd: string;
  signal?: AbortSignal;
  operations: GrepToolOperations;
  timeoutMs: number;
  maxBufferBytes: number;
  onLine: (line: string) => "continue" | "stop";
}): Promise<RipgrepRunResult> {
  const attempt = async (singleThreaded: boolean): Promise<RipgrepRunResult> => {
    return await new Promise((resolve, reject) => {
      const args = singleThreaded ? ["-j", "1", ...params.args] : params.args;
      let child: ChildProcess;
      try {
        child = params.operations.spawn("rg", args, { cwd: params.cwd });
      } catch (error) {
        reject(error);
        return;
      }

      let stderr = "";
      let aborted = false;
      let timedOut = false;
      let maxBufferExceeded = false;
      let stoppedByCaller = false;
      let emittedLines = 0;
      let bufferedBytes = 0;
      let pending = "";
      const decoder = new StringDecoder("utf8");
      let stdoutEnded = false;

      const cleanup = () => {
        if (timeout) {
          clearTimeout(timeout);
        }
        params.signal?.removeEventListener("abort", onAbort);
      };

      const onAbort = () => {
        aborted = true;
        child.kill();
      };

      const timeout =
        params.timeoutMs > 0
          ? setTimeout(() => {
              timedOut = true;
              child.kill();
            }, params.timeoutMs)
          : null;

      const emitLine = (line: string) => {
        const normalizedLine = line.endsWith("\r") ? line.slice(0, -1) : line;
        const nextBytes = bufferedBytes + Buffer.byteLength(normalizedLine, "utf8") + 1;
        if (nextBytes > params.maxBufferBytes) {
          maxBufferExceeded = true;
          child.kill();
          return;
        }
        bufferedBytes = nextBytes;
        emittedLines += 1;
        if (params.onLine(normalizedLine) === "stop") {
          stoppedByCaller = true;
          child.kill();
        }
      };

      const processText = (text: string, flush: boolean) => {
        pending += text;
        for (;;) {
          const newlineIndex = pending.indexOf("\n");
          if (newlineIndex === -1) {
            break;
          }
          const line = pending.slice(0, newlineIndex);
          pending = pending.slice(newlineIndex + 1);
          emitLine(line);
          if (maxBufferExceeded || stoppedByCaller) {
            return;
          }
        }
        if (flush && pending.length > 0 && !timedOut && !maxBufferExceeded) {
          emitLine(pending);
          pending = "";
        }
      };

      params.signal?.addEventListener("abort", onAbort, { once: true });
      child.stderr?.on("data", (chunk: Buffer | string) => {
        stderr += chunk.toString("utf8");
      });
      child.stdout?.on("data", (chunk: Buffer | string) => {
        processText(decoder.write(chunk as Buffer), false);
      });
      child.stdout?.on("end", () => {
        stdoutEnded = true;
        processText(decoder.end(), true);
      });
      child.on("error", (error: Error) => {
        cleanup();
        reject(error);
      });
      child.on("close", (code: number | null) => {
        if (!stdoutEnded) {
          decoder.end();
        }
        cleanup();
        if (aborted) {
          reject(new Error("Operation aborted"));
          return;
        }
        if (timedOut || maxBufferExceeded) {
          if (emittedLines > 0) {
            resolve({
              searchStatus: "partial_timeout",
              emittedLines,
            });
            return;
          }
          reject(
            new SearchTimeoutError(
              timedOut
                ? `ripgrep timed out after ${params.timeoutMs}ms`
                : "ripgrep output exceeded the configured buffer limit",
              timedOut ? "timeout" : "max_buffer",
            ),
          );
          return;
        }
        if (stoppedByCaller) {
          resolve({ searchStatus: "matches", emittedLines });
          return;
        }
        if (code === 1) {
          resolve({ searchStatus: "no_match", emittedLines });
          return;
        }
        if (code === 0) {
          resolve({ searchStatus: "matches", emittedLines });
          return;
        }
        reject(new Error(stderr.trim() || `ripgrep exited with code ${String(code)}`));
      });
    });
  };

  try {
    return await attempt(false);
  } catch (error) {
    if (isEagainError(error)) {
      return await attempt(true);
    }
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOENT") {
      throw new Error("ripgrep (rg) is not installed or not available on PATH.", { cause: error });
    }
    if (code === "EACCES" || code === "EPERM") {
      throw new Error("ripgrep could not read the requested path because access was denied.", {
        cause: error,
      });
    }
    throw error;
  }
}

async function runContentScan(params: {
  args: string[];
  cwd: string;
  signal?: AbortSignal;
  operations: GrepToolOperations;
  offset: number;
  headLimit: number;
  timeoutMs: number;
  maxBufferBytes: number;
}): Promise<ContentScanResult> {
  const rawLines: string[] = [];
  const uniqueFiles = new Set<string>();
  let linesSeen = 0;
  let hasMore = false;
  const result = await runRipgrepLines({
    args: params.args,
    cwd: params.cwd,
    signal: params.signal,
    operations: params.operations,
    timeoutMs: params.timeoutMs,
    maxBufferBytes: params.maxBufferBytes,
    onLine: (line) => {
      if (params.headLimit > 0 && linesSeen >= params.offset + params.headLimit) {
        hasMore = true;
        return "stop";
      }
      if (linesSeen >= params.offset) {
        rawLines.push(line);
        const file = extractRawLineFile(line);
        if (file) {
          uniqueFiles.add(file);
        }
      }
      linesSeen += 1;
      return "continue";
    },
  });
  return {
    searchStatus: result.searchStatus,
    rawLines,
    uniqueFiles,
    hasMore,
  };
}

async function sortFilesByMtime(params: {
  entries: CountEntry[];
  cwd: string;
  operations: GrepToolOperations;
}): Promise<CountEntry[]> {
  if (params.entries.length <= 1 || params.entries.length > MTIME_SORT_CAP) {
    return params.entries;
  }

  const settled = await Promise.allSettled(
    params.entries.map(async (entry) => ({
      entry,
      stat: await params.operations.stat(path.resolve(params.cwd, entry.file)),
    })),
  );

  const ranked = settled.map((result, index) => {
    if (result.status === "fulfilled") {
      return {
        entry: result.value.entry,
        mtimeMs: Number.isFinite(result.value.stat.mtimeMs) ? result.value.stat.mtimeMs : -Infinity,
      };
    }
    return {
      entry: params.entries[index],
      mtimeMs: -Infinity,
    };
  });

  ranked.sort((left, right) => {
    if (right.mtimeMs !== left.mtimeMs) {
      return right.mtimeMs - left.mtimeMs;
    }
    return left.entry.file.localeCompare(right.entry.file);
  });

  return ranked.map((entry) => entry.entry);
}

function applyPagination<T>(
  items: readonly T[],
  offset: number,
  headLimit: number,
): {
  page: T[];
  hasMore: boolean;
  nextOffset: number | null;
} {
  const start = Math.max(0, offset);
  if (headLimit === 0) {
    const page = items.slice(start);
    return {
      page,
      hasMore: false,
      nextOffset: null,
    };
  }
  const page = items.slice(start, start + headLimit);
  const hasMore = start + headLimit < items.length;
  return {
    page,
    hasMore,
    nextOffset: hasMore ? start + page.length : null,
  };
}

function buildSummary(details: GrepToolDetails): string {
  if (details.searchStatus === "no_match") {
    return "No matches found.";
  }

  const partialPrefix =
    details.searchStatus === "partial_timeout" ? "Search timed out after partial results. " : "";

  if (details.outputMode === "files_with_matches") {
    if ((details.filenames?.length ?? 0) === 0) {
      return `${partialPrefix}No complete filename results were captured.`;
    }
    const header = details.hasMore
      ? `${partialPrefix}Found ${details.returnedFiles} of ${details.totalFilesFound} matching files (${details.totalMatchesFound} total matches). More available; next offset ${details.nextOffset}.`
      : `${partialPrefix}Found ${details.totalFilesFound} matching files (${details.totalMatchesFound} total matches).`;
    return [header, "", ...(details.filenames ?? [])].join("\n");
  }

  if (details.outputMode === "count") {
    if ((details.countLines?.length ?? 0) === 0) {
      return `${partialPrefix}No complete count results were captured.`;
    }
    const header = details.hasMore
      ? `${partialPrefix}Found ${details.totalMatchesFound} matches across ${details.totalFilesFound} files. Returning ${details.returnedLines} count lines; next offset ${details.nextOffset}.`
      : `${partialPrefix}Found ${details.totalMatchesFound} matches across ${details.totalFilesFound} files.`;
    return [header, "", ...(details.countLines ?? [])].join("\n");
  }

  if (!details.content?.trim()) {
    return details.totalMatchesFound > 0
      ? `${partialPrefix}Found ${details.totalMatchesFound} matches across ${details.totalFilesFound} files, but this page returned no content lines.`
      : `${partialPrefix}No matches found.`;
  }

  const header = details.hasMore
    ? `${partialPrefix}Found ${details.totalMatchesFound} matches across ${details.totalFilesFound} files. Returning ${details.returnedLines} content lines; next offset ${details.nextOffset}.`
    : `${partialPrefix}Found ${details.totalMatchesFound} matches across ${details.totalFilesFound} files.`;
  return [header, "", details.content].join("\n");
}

function createResult(details: GrepToolDetails): AgentToolResult<GrepToolDetails> {
  return {
    content: [{ type: "text", text: buildSummary(details) }],
    details,
  };
}

export function createGrepTool(options?: {
  cwd?: string;
  sandboxRoot?: string;
  operations?: Partial<GrepToolOperations>;
  timeoutMs?: number;
  maxBufferBytes?: number;
  isSlowFilesystemEnv?: () => boolean;
}): AnyAgentTool {
  const cwd = options?.cwd ?? resolveAgentRuntimeCwd();
  const sandboxRoot = options?.sandboxRoot?.trim() ? path.resolve(options.sandboxRoot) : undefined;
  const operations = {
    ...defaultOperations,
    ...options?.operations,
  } satisfies GrepToolOperations;
  const timeoutMs =
    options?.timeoutMs ?? resolveGrepTimeoutMs(process.env, options?.isSlowFilesystemEnv);
  const maxBufferBytes = options?.maxBufferBytes ?? resolveGrepMaxBufferBytes(process.env);

  return defineOpenClawTool({
    name: "grep",
    label: "Search",
    description:
      "Search file contents with ripgrep. Always prefer this over raw shell rg/grep for workspace content search. Supports regex, filenames-only/count/content modes, pagination via offset/head_limit, and optional multiline search.",
    parameters: GrepToolInputSchema,
    inputSchema: GrepToolInputSchema,
    outputSchema: GrepToolOutputSchema,
    isReadOnly: () => true,
    isConcurrencySafe: () => true,
    operatorManual: () =>
      [
        "Purpose: search repository file contents with a bounded, read-only ripgrep wrapper.",
        "Use this instead of raw shell `rg`/`grep` when the tool is available.",
        "Regex is supported.",
        'Use `output_mode="files_with_matches"` to discover candidate files, `output_mode="count"` to gauge breadth, and `output_mode="content"` to inspect matching lines.',
        "Use `offset` + `head_limit` to paginate instead of asking for huge result sets.",
        "Set `multiline=true` only when you need cross-line matches because it is more expensive.",
      ].join("\n"),
    validateInput: async (input, _context) => {
      if (input.pattern.includes("\n") && !input.multiline) {
        return {
          result: false,
          message: "Pattern contains a newline. Set multiline=true for cross-line regex search.",
          code: "invalid_input",
        };
      }

      const target = resolveSearchTarget(cwd, input.path);
      if (sandboxRoot) {
        await assertSandboxPath({
          filePath: target.resolvedPath,
          cwd: sandboxRoot,
          root: sandboxRoot,
        });
      }
      await statSearchTarget(target, operations);
      return { result: true };
    },
    execute: async (_toolCallId, input, signal) => {
      await ensureRipgrepHealthy(operations);
      const target = await statSearchTarget(resolveSearchTarget(cwd, input.path), operations);
      const outputMode = input.output_mode ?? "files_with_matches";
      const offset = input.offset ?? 0;
      const headLimit = input.head_limit ?? DEFAULT_HEAD_LIMIT;

      const countScan = await runCountScan({
        args: buildCountArgs(input, target),
        cwd: target.cwd,
        signal,
        operations,
        timeoutMs,
        maxBufferBytes,
      });

      if (countScan.totalMatchesFound === 0) {
        return createResult({
          ok: true,
          searchStatus: countScan.searchStatus,
          outputMode,
          totalFilesFound: 0,
          totalMatchesFound: 0,
          returnedFiles: 0,
          returnedLines: 0,
          hasMore: false,
          nextOffset: null,
          ...(offset > 0 ? { appliedOffset: offset } : {}),
          ...(outputMode === "content"
            ? { content: "", numLines: 0 }
            : outputMode === "count"
              ? { countLines: [], numMatches: 0, numFiles: 0 }
              : { filenames: [], numFiles: 0 }),
        });
      }

      if (outputMode === "content") {
        const contentScan = await runContentScan({
          args: buildContentArgs(input, target),
          cwd: target.cwd,
          signal,
          operations,
          offset,
          headLimit,
          timeoutMs,
          maxBufferBytes,
        });
        const normalizedLines = contentScan.rawLines.map(normalizeContentLine);
        const content = normalizedLines.join("\n");
        const searchStatus =
          countScan.searchStatus === "partial_timeout" ||
          contentScan.searchStatus === "partial_timeout"
            ? "partial_timeout"
            : countScan.searchStatus;
        return createResult({
          ok: true,
          searchStatus,
          outputMode,
          totalFilesFound: countScan.totalFilesFound,
          totalMatchesFound: countScan.totalMatchesFound,
          returnedFiles: contentScan.uniqueFiles.size,
          returnedLines: normalizedLines.length,
          hasMore: contentScan.hasMore,
          nextOffset: contentScan.hasMore ? offset + normalizedLines.length : null,
          ...(contentScan.hasMore && headLimit > 0 ? { appliedLimit: headLimit } : {}),
          ...(offset > 0 ? { appliedOffset: offset } : {}),
          content,
          numLines: normalizedLines.length,
        });
      }

      const rankedEntries =
        outputMode === "files_with_matches"
          ? await sortFilesByMtime({
              entries: countScan.entries,
              cwd: target.cwd,
              operations,
            })
          : countScan.entries;
      const paginated = applyPagination(rankedEntries, offset, headLimit);

      if (outputMode === "files_with_matches") {
        const filenames = paginated.page.map((entry) => cleanRelativePath(entry.file));
        return createResult({
          ok: true,
          searchStatus: countScan.searchStatus,
          outputMode,
          totalFilesFound: countScan.totalFilesFound,
          totalMatchesFound: countScan.totalMatchesFound,
          returnedFiles: filenames.length,
          returnedLines: filenames.length,
          hasMore: paginated.hasMore,
          nextOffset: paginated.nextOffset,
          ...(paginated.hasMore && headLimit > 0 ? { appliedLimit: headLimit } : {}),
          ...(offset > 0 ? { appliedOffset: offset } : {}),
          filenames,
          numFiles: filenames.length,
        });
      }

      const countLines = paginated.page.map(
        (entry) => `${cleanRelativePath(entry.file)}:${String(entry.count)}`,
      );
      return createResult({
        ok: true,
        searchStatus: countScan.searchStatus,
        outputMode,
        totalFilesFound: countScan.totalFilesFound,
        totalMatchesFound: countScan.totalMatchesFound,
        returnedFiles: paginated.page.length,
        returnedLines: countLines.length,
        hasMore: paginated.hasMore,
        nextOffset: paginated.nextOffset,
        ...(paginated.hasMore && headLimit > 0 ? { appliedLimit: headLimit } : {}),
        ...(offset > 0 ? { appliedOffset: offset } : {}),
        countLines,
        numMatches: countScan.totalMatchesFound,
        numFiles: countScan.totalFilesFound,
      });
    },
  });
}
