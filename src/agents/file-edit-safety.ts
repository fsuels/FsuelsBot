import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import crypto from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ToolFailureCode } from "./tool-contract.js";
import { assertSandboxPath } from "./sandbox-paths.js";
import { createStructuredToolFailureResult } from "./tool-contracts.js";

const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;
const NARROW_NO_BREAK_SPACE = "\u202F";
const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const UTF16LE_BOM = Buffer.from([0xff, 0xfe]);
const UTF16BE_BOM = Buffer.from([0xfe, 0xff]);
const BLOCKED_SPECIAL_PATHS = new Set([
  "/dev/zero",
  "/dev/random",
  "/dev/urandom",
  "/dev/full",
  "/dev/stdin",
  "/dev/stdout",
  "/dev/stderr",
  "/dev/tty",
  "/dev/console",
  "/dev/fd/0",
  "/dev/fd/1",
  "/dev/fd/2",
]);
const BLOCKED_PROC_FD_RE = /^\/proc\/[^/]+\/fd\/([012])$/;

export type FileToolErrorCode =
  | "file_not_read"
  | "partial_read_only"
  | "file_missing"
  | "file_changed_since_read"
  | "string_not_found"
  | "multiple_matches"
  | "file_too_large"
  | "invalid_edit_request"
  | "permission_denied"
  | "invalid_file_type"
  | "invalid_read_range"
  | "parse_failure"
  | "network_path_blocked"
  | "unsafe_path_blocked";

export type TextEncoding = "utf8" | "utf16le" | "utf16be";

export type TextFileMetadata = {
  encoding: TextEncoding;
  bom: boolean;
  newline: "\n" | "\r\n" | "\r";
};

type TrackedFileState = {
  resolvedPath: string;
  canonicalPath: string;
  readAtMs: number;
  hash?: string;
  mtimeMs: number;
  size: number;
  content?: string;
  partial: boolean;
  readOffset?: number;
  readLimit?: number;
  readKind: "text" | "image";
  textMetadata?: TextFileMetadata;
};

export type FileReadStateSeed = {
  path: string;
  mtimeMs: number;
  contentHash?: string;
  readAtMs?: number;
  size?: number;
  partial?: boolean;
  readOffset?: number;
  readLimit?: number;
  readKind?: "text" | "image";
};

type MutationCheck = {
  exists: boolean;
  resolvedPath: string;
  currentState?: TrackedFileState;
  previousState?: TrackedFileState;
};

type ResolvePathOptions = {
  cwd: string;
  sandboxRoot?: string;
  readMode?: boolean;
};

type ExistingPathSnapshot = {
  exists: boolean;
  resolvedPath: string;
  state?: TrackedFileState;
};

type ReadTrackingInfo = {
  partial: boolean;
  readOffset?: number;
  readLimit?: number;
  readKind: "text" | "image";
};

function deriveReadTrackingInfo(params: {
  result?: AgentToolResult<unknown>;
  offset?: number;
  limit?: number;
}): ReadTrackingInfo {
  const content = Array.isArray(params.result?.content) ? params.result.content : [];
  const hasImage = content.some(
    (block) =>
      !!block && typeof block === "object" && (block as { type?: unknown }).type === "image",
  );
  const details =
    params.result?.details && typeof params.result.details === "object"
      ? (params.result.details as {
          truncated?: boolean;
          firstLineExceedsLimit?: boolean;
          truncation?: { truncated?: boolean; firstLineExceedsLimit?: boolean };
        })
      : undefined;
  const truncation = details?.truncation;
  const truncated =
    details?.truncated === true ||
    truncation?.truncated === true ||
    details?.firstLineExceedsLimit === true ||
    truncation?.firstLineExceedsLimit === true;
  return {
    partial:
      hasImage ||
      (typeof params.offset === "number" && params.offset > 1) ||
      params.limit !== undefined ||
      truncated,
    readOffset: typeof params.offset === "number" ? params.offset : undefined,
    readLimit: typeof params.limit === "number" ? params.limit : undefined,
    readKind: hasImage ? "image" : "text",
  };
}

export class FileToolError extends Error {
  readonly errorCode: FileToolErrorCode;
  readonly contractCode: ToolFailureCode;
  readonly details?: Record<string, unknown>;

  constructor(params: {
    errorCode: FileToolErrorCode;
    message: string;
    contractCode?: ToolFailureCode;
    details?: Record<string, unknown>;
  }) {
    super(params.message);
    this.name = "FileToolError";
    this.errorCode = params.errorCode;
    this.contractCode = params.contractCode ?? "precondition_failed";
    this.details = params.details;
  }
}

function normalizeUnicodeSpaces(value: string): string {
  return value.replace(UNICODE_SPACES, " ");
}

function normalizeAtPrefix(value: string): string {
  return value.startsWith("@") ? value.slice(1) : value;
}

function expandPath(filePath: string): string {
  const normalized = normalizeUnicodeSpaces(normalizeAtPrefix(filePath.trim()));
  if (normalized === "~") {
    return os.homedir();
  }
  if (normalized.startsWith("~/")) {
    return os.homedir() + normalized.slice(1);
  }
  return normalized;
}

function resolveToCwd(filePath: string, cwd: string): string {
  const expanded = expandPath(filePath);
  if (path.isAbsolute(expanded)) {
    return expanded;
  }
  return path.resolve(cwd, expanded);
}

function tryMacOSScreenshotPath(filePath: string): string {
  return filePath.replace(/ (AM|PM)\./g, `${NARROW_NO_BREAK_SPACE}$1.`);
}

function tryNFDVariant(filePath: string): string {
  return filePath.normalize("NFD");
}

function tryCurlyQuoteVariant(filePath: string): string {
  return filePath.replace(/'/g, "\u2019");
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveExistingPathVariant(filePath: string): Promise<string> {
  if (await fileExists(filePath)) {
    return filePath;
  }

  const variants = [
    tryMacOSScreenshotPath(filePath),
    tryNFDVariant(filePath),
    tryCurlyQuoteVariant(filePath),
    tryCurlyQuoteVariant(tryNFDVariant(filePath)),
  ];

  for (const candidate of variants) {
    if (candidate !== filePath && (await fileExists(candidate))) {
      return candidate;
    }
  }

  return filePath;
}

function isWindowsUncPath(rawPath: string): boolean {
  if (/^\\\\[^\\/?*<>|]+[\\/][^\\/?*<>|]+/.test(rawPath)) {
    return true;
  }
  if (/^\/\/[^/?*<>|]+\/[^/?*<>|]+/.test(rawPath)) {
    return true;
  }
  return false;
}

export function assertSafeToolPathInput(toolName: string, filePath: string): void {
  const trimmed = filePath.trim();
  if (isWindowsUncPath(trimmed)) {
    throw new FileToolError({
      errorCode: "network_path_blocked",
      message: `${toolName} blocked a Windows UNC/network path. Use a local path instead.`,
      details: { path: trimmed },
    });
  }
}

function normalizeResolvedPathForSafetyCheck(resolvedPath: string): string {
  const normalized = path.posix.normalize(resolvedPath.replace(/\\/g, "/"));
  if (normalized.length > 1 && normalized.endsWith("/")) {
    return normalized.slice(0, -1);
  }
  return normalized;
}

export function assertSafeResolvedToolPath(toolName: string, resolvedPath: string): void {
  const normalized = normalizeResolvedPathForSafetyCheck(resolvedPath);
  if (BLOCKED_SPECIAL_PATHS.has(normalized) || BLOCKED_PROC_FD_RE.test(normalized)) {
    throw new FileToolError({
      errorCode: "unsafe_path_blocked",
      contractCode: "invalid_input",
      message:
        `${toolName} blocked a special device or stream path that can hang or stream forever. ` +
        "Use a regular workspace file instead.",
      details: { path: resolvedPath },
    });
  }
}

function mapNodeErrorToFileToolError(
  err: unknown,
  fallbackMessage: string,
  details?: Record<string, unknown>,
): FileToolError | null {
  if (!err || typeof err !== "object" || !("code" in err)) {
    return null;
  }

  const code =
    typeof (err as { code?: unknown }).code === "string" ? (err as { code: string }).code : "";
  if (code === "EACCES" || code === "EPERM") {
    return new FileToolError({
      errorCode: "permission_denied",
      message: fallbackMessage,
      details,
    });
  }
  if (code === "EISDIR" || code === "ENOTDIR") {
    return new FileToolError({
      errorCode: "invalid_file_type",
      contractCode: "invalid_input",
      message: fallbackMessage,
      details,
    });
  }
  return null;
}

function normalizeToLF(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function detectLineEnding(text: string): "\n" | "\r\n" | "\r" {
  if (text.includes("\r\n")) {
    return "\r\n";
  }
  if (text.includes("\r")) {
    return "\r";
  }
  return "\n";
}

function restoreLineEndings(text: string, newline: "\n" | "\r\n" | "\r"): string {
  const normalized = normalizeToLF(text);
  if (newline === "\r\n") {
    return normalized.replace(/\n/g, "\r\n");
  }
  if (newline === "\r") {
    return normalized.replace(/\n/g, "\r");
  }
  return normalized;
}

function computeHash(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function hasTrackedFileStateChanged(params: {
  previousState: TrackedFileState;
  currentState: TrackedFileState;
}): boolean {
  const { previousState, currentState } = params;
  if (typeof previousState.content === "string" && typeof currentState.content === "string") {
    return previousState.content !== currentState.content;
  }
  if (previousState.hash && currentState.hash) {
    return previousState.hash !== currentState.hash;
  }
  if (previousState.mtimeMs !== currentState.mtimeMs) {
    return true;
  }
  return previousState.size !== currentState.size;
}

function normalizeReadStateCacheSize(maxEntries?: number): number {
  if (typeof maxEntries !== "number" || !Number.isFinite(maxEntries)) {
    return 256;
  }
  return Math.max(1, Math.floor(maxEntries));
}

function detectEncoding(buffer: Buffer): {
  encoding: TextEncoding;
  bom: boolean;
  body: Buffer;
} {
  if (buffer.subarray(0, UTF8_BOM.length).equals(UTF8_BOM)) {
    return { encoding: "utf8", bom: true, body: buffer.subarray(UTF8_BOM.length) };
  }
  if (buffer.subarray(0, UTF16LE_BOM.length).equals(UTF16LE_BOM)) {
    return { encoding: "utf16le", bom: true, body: buffer.subarray(UTF16LE_BOM.length) };
  }
  if (buffer.subarray(0, UTF16BE_BOM.length).equals(UTF16BE_BOM)) {
    return { encoding: "utf16be", bom: true, body: buffer.subarray(UTF16BE_BOM.length) };
  }

  let evenZeroes = 0;
  let oddZeroes = 0;
  for (let index = 0; index < buffer.length; index += 1) {
    if (buffer[index] !== 0) {
      continue;
    }
    if (index % 2 === 0) {
      evenZeroes += 1;
    } else {
      oddZeroes += 1;
    }
  }

  const threshold = Math.max(2, Math.floor(buffer.length / 4));
  if (oddZeroes >= threshold && evenZeroes < threshold / 2) {
    return { encoding: "utf16le", bom: false, body: buffer };
  }
  if (evenZeroes >= threshold && oddZeroes < threshold / 2) {
    return { encoding: "utf16be", bom: false, body: buffer };
  }
  return { encoding: "utf8", bom: false, body: buffer };
}

export function decodeTextBuffer(buffer: Buffer): { text: string; metadata: TextFileMetadata } {
  const detected = detectEncoding(buffer);
  let text: string;
  try {
    text = new TextDecoder(detected.encoding).decode(detected.body);
  } catch (err) {
    throw new FileToolError({
      errorCode: "parse_failure",
      contractCode: "invalid_input",
      message: "Failed to decode file contents for safe editing.",
      details: { cause: err instanceof Error ? err.message : String(err) },
    });
  }
  return {
    text,
    metadata: {
      encoding: detected.encoding,
      bom: detected.bom,
      newline: detectLineEnding(text),
    },
  };
}

export function encodeTextWithMetadata(text: string, metadata?: TextFileMetadata): Buffer {
  const bomFromText = text.startsWith("\uFEFF");
  const content = bomFromText ? text.slice(1) : text;
  const nextMetadata: TextFileMetadata = metadata ?? {
    encoding: "utf8",
    bom: bomFromText,
    newline: detectLineEnding(content),
  };
  const withLineEndings = restoreLineEndings(content, nextMetadata.newline);
  let body: Buffer;
  switch (nextMetadata.encoding) {
    case "utf16le":
      body = Buffer.from(withLineEndings, "utf16le");
      break;
    case "utf16be":
      body = Buffer.from(withLineEndings, "utf16le").swap16();
      break;
    case "utf8":
    default:
      body = Buffer.from(withLineEndings, "utf8");
      break;
  }

  if (nextMetadata.bom || bomFromText) {
    if (nextMetadata.encoding === "utf16le") {
      return Buffer.concat([UTF16LE_BOM, body]);
    }
    if (nextMetadata.encoding === "utf16be") {
      return Buffer.concat([UTF16BE_BOM, body]);
    }
    return Buffer.concat([UTF8_BOM, body]);
  }

  return body;
}

async function buildTrackedStateFromResolvedPath(resolvedPath: string, buffer?: Buffer) {
  let stat;
  try {
    stat = await fs.stat(resolvedPath);
  } catch (err) {
    const mapped = mapNodeErrorToFileToolError(err, `Cannot access ${resolvedPath}`, {
      path: resolvedPath,
    });
    if (mapped) {
      throw mapped;
    }
    throw err;
  }

  if (!stat.isFile()) {
    throw new FileToolError({
      errorCode: "invalid_file_type",
      contractCode: "invalid_input",
      message: `Path is not a regular file: ${resolvedPath}`,
      details: { path: resolvedPath },
    });
  }

  const raw =
    buffer ??
    (await fs.readFile(resolvedPath).catch((err) => {
      const mapped = mapNodeErrorToFileToolError(err, `Cannot read ${resolvedPath}`, {
        path: resolvedPath,
      });
      if (mapped) {
        throw mapped;
      }
      throw err;
    }));
  const canonicalPath = await fs.realpath(resolvedPath).catch(() => path.normalize(resolvedPath));
  const decoded = decodeTextBuffer(raw);

  return {
    resolvedPath,
    canonicalPath,
    readAtMs: Date.now(),
    hash: computeHash(raw),
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    content: decoded.text,
    partial: false,
    readKind: "text",
    textMetadata: decoded.metadata,
  } satisfies TrackedFileState;
}

async function buildTrackedHeaderFromResolvedPath(
  resolvedPath: string,
  info: ReadTrackingInfo,
): Promise<TrackedFileState> {
  let stat;
  try {
    stat = await fs.stat(resolvedPath);
  } catch (err) {
    const mapped = mapNodeErrorToFileToolError(err, `Cannot access ${resolvedPath}`, {
      path: resolvedPath,
    });
    if (mapped) {
      throw mapped;
    }
    throw err;
  }

  if (!stat.isFile()) {
    throw new FileToolError({
      errorCode: "invalid_file_type",
      contractCode: "invalid_input",
      message: `Path is not a regular file: ${resolvedPath}`,
      details: { path: resolvedPath },
    });
  }

  const canonicalPath = await fs.realpath(resolvedPath).catch(() => path.normalize(resolvedPath));
  return {
    resolvedPath,
    canonicalPath,
    readAtMs: Date.now(),
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    partial: info.partial,
    readOffset: info.readOffset,
    readLimit: info.readLimit,
    readKind: info.readKind,
  };
}

async function resolveRequestedPath(
  filePath: string,
  options: ResolvePathOptions,
): Promise<string> {
  assertSafeToolPathInput("file", filePath);
  if (options.sandboxRoot) {
    const resolved = await assertSandboxPath({
      filePath,
      cwd: options.cwd,
      root: options.sandboxRoot,
    });
    assertSafeResolvedToolPath("file", resolved.resolved);
    return resolved.resolved;
  }

  const absolutePath = resolveToCwd(filePath, options.cwd);
  assertSafeResolvedToolPath("file", absolutePath);
  if (options.readMode) {
    return await resolveExistingPathVariant(absolutePath);
  }
  return absolutePath;
}

export async function resolveSafeToolPath(
  filePath: string,
  options: ResolvePathOptions,
): Promise<string> {
  return await resolveRequestedPath(filePath, options);
}

export async function resolveFileToolPath(params: {
  filePath: string;
  cwd: string;
  sandboxRoot?: string;
  readMode?: boolean;
}): Promise<string> {
  return await resolveRequestedPath(params.filePath, {
    cwd: params.cwd,
    sandboxRoot: params.sandboxRoot,
    readMode: params.readMode,
  });
}

function normalizeToolName(toolName: string): string {
  return toolName.trim().toLowerCase() || "tool";
}

function formatFailureResult(params: {
  toolName: string;
  errorCode: FileToolErrorCode;
  message: string;
  contractCode?: ToolFailureCode;
  details?: Record<string, unknown>;
}) {
  return createStructuredToolFailureResult({
    toolName: normalizeToolName(params.toolName),
    code: params.contractCode ?? "precondition_failed",
    message: params.message,
    details: {
      error_code: params.errorCode,
      ...params.details,
    },
  });
}

export function fileToolErrorToResult(toolName: string, err: FileToolError) {
  return formatFailureResult({
    toolName,
    errorCode: err.errorCode,
    message: err.message,
    contractCode: err.contractCode,
    details: err.details,
  });
}

export function createFileEditStateTracker(options?: { maxEntries?: number }) {
  const readStateByCanonicalPath = new Map<string, TrackedFileState>();
  const maxEntries = normalizeReadStateCacheSize(options?.maxEntries);

  function setTrackedState(state: TrackedFileState): TrackedFileState {
    readStateByCanonicalPath.delete(state.canonicalPath);
    readStateByCanonicalPath.set(state.canonicalPath, state);
    while (readStateByCanonicalPath.size > maxEntries) {
      const oldestKey = readStateByCanonicalPath.keys().next().value;
      if (typeof oldestKey !== "string") {
        break;
      }
      readStateByCanonicalPath.delete(oldestKey);
    }
    return state;
  }

  function touchTrackedState(state: TrackedFileState): TrackedFileState {
    if (!readStateByCanonicalPath.has(state.canonicalPath)) {
      return state;
    }
    return setTrackedState(state);
  }

  function findTrackedStateForAbsolutePath(absolutePath: string): TrackedFileState | undefined {
    const normalizedPath = path.normalize(absolutePath);
    for (const tracked of readStateByCanonicalPath.values()) {
      if (
        path.normalize(tracked.resolvedPath) === normalizedPath ||
        path.normalize(tracked.canonicalPath) === normalizedPath
      ) {
        return touchTrackedState(tracked);
      }
    }
    return undefined;
  }

  async function rememberResolvedPath(resolvedPath: string, buffer?: Buffer) {
    const state = await buildTrackedStateFromResolvedPath(resolvedPath, buffer);
    return setTrackedState(state);
  }

  async function rememberReadHeader(resolvedPath: string, info: ReadTrackingInfo) {
    const state = await buildTrackedHeaderFromResolvedPath(resolvedPath, info);
    return setTrackedState(state);
  }

  async function seedReadState(params: {
    path: string;
    cwd: string;
    sandboxRoot?: string;
    mtimeMs: number;
    contentHash?: string;
    readAtMs?: number;
    size?: number;
    partial?: boolean;
    readOffset?: number;
    readLimit?: number;
    readKind?: "text" | "image";
  }): Promise<void> {
    const resolvedPath = await resolveRequestedPath(params.path, {
      cwd: params.cwd,
      sandboxRoot: params.sandboxRoot,
      readMode: true,
    });
    let stat;
    try {
      stat = await fs.stat(resolvedPath);
    } catch (err) {
      const mapped = mapNodeErrorToFileToolError(err, `Cannot access ${resolvedPath}`, {
        path: resolvedPath,
      });
      if (mapped) {
        throw mapped;
      }
      throw err;
    }

    if (!stat.isFile()) {
      throw new FileToolError({
        errorCode: "invalid_file_type",
        contractCode: "invalid_input",
        message: `Path is not a regular file: ${resolvedPath}`,
        details: { path: resolvedPath },
      });
    }

    const canonicalPath = await fs.realpath(resolvedPath).catch(() => path.normalize(resolvedPath));
    setTrackedState({
      resolvedPath,
      canonicalPath,
      readAtMs:
        typeof params.readAtMs === "number" && Number.isFinite(params.readAtMs)
          ? params.readAtMs
          : Date.now(),
      hash: params.contentHash?.trim() || undefined,
      mtimeMs:
        typeof params.mtimeMs === "number" && Number.isFinite(params.mtimeMs)
          ? params.mtimeMs
          : stat.mtimeMs,
      size:
        typeof params.size === "number" && Number.isFinite(params.size)
          ? Math.max(0, params.size)
          : stat.size,
      partial: params.partial === true,
      readOffset: typeof params.readOffset === "number" ? params.readOffset : undefined,
      readLimit: typeof params.readLimit === "number" ? params.readLimit : undefined,
      readKind: params.readKind ?? "text",
    });
  }

  function snapshotReadStates(): FileReadStateSeed[] {
    return [...readStateByCanonicalPath.values()].map((state) => ({
      path: state.resolvedPath,
      mtimeMs: state.mtimeMs,
      contentHash: state.hash,
      readAtMs: state.readAtMs,
      size: state.size,
      partial: state.partial,
      readOffset: state.readOffset,
      readLimit: state.readLimit,
      readKind: state.readKind,
    }));
  }

  async function recordRead(params: {
    filePath: string;
    cwd: string;
    sandboxRoot?: string;
    result?: AgentToolResult<unknown>;
    offset?: number;
    limit?: number;
  }): Promise<void> {
    const resolvedPath = await resolveRequestedPath(params.filePath, {
      cwd: params.cwd,
      sandboxRoot: params.sandboxRoot,
      readMode: true,
    });
    const trackingInfo = deriveReadTrackingInfo({
      result: params.result,
      offset: params.offset,
      limit: params.limit,
    });
    if (trackingInfo.partial) {
      await rememberReadHeader(resolvedPath, trackingInfo);
      return;
    }
    await rememberResolvedPath(resolvedPath);
  }

  async function getExistingSnapshot(absolutePath: string): Promise<ExistingPathSnapshot> {
    const resolvedPath = await resolveExistingPathVariant(path.normalize(absolutePath));
    try {
      const state = await buildTrackedStateFromResolvedPath(resolvedPath);
      return { exists: true, resolvedPath, state };
    } catch (err) {
      if (
        err &&
        typeof err === "object" &&
        "code" in (err as Record<string, unknown>) &&
        ((err as NodeJS.ErrnoException).code === "ENOENT" ||
          (err as NodeJS.ErrnoException).code === "ENOTDIR")
      ) {
        return { exists: false, resolvedPath };
      }
      throw err;
    }
  }

  async function ensureExistingFileIsFresh(
    toolName: string,
    absolutePath: string,
  ): Promise<MutationCheck> {
    const snapshot = await getExistingSnapshot(absolutePath);
    if (!snapshot.exists || !snapshot.state) {
      const previousState = findTrackedStateForAbsolutePath(absolutePath);
      if (previousState) {
        throw new FileToolError({
          errorCode: "file_changed_since_read",
          message:
            `${toolName} aborted because the file changed after it was read. ` +
            "Read the latest file contents, then retry the edit.",
          details: {
            path: path.normalize(absolutePath),
            read_mtime_ms: previousState.mtimeMs,
            current_state: "missing",
          },
        });
      }
      return { exists: false, resolvedPath: snapshot.resolvedPath };
    }

    const previousStateRaw = readStateByCanonicalPath.get(snapshot.state.canonicalPath);
    const previousState = previousStateRaw ? touchTrackedState(previousStateRaw) : undefined;
    if (!previousState) {
      throw new FileToolError({
        errorCode: "file_not_read",
        message:
          `${toolName} requires a successful read of the existing file in this run. ` +
          "Read the file first, then retry the edit.",
        details: { path: snapshot.state.resolvedPath },
      });
    }

    if (previousState.partial) {
      throw new FileToolError({
        errorCode: "partial_read_only",
        message:
          `${toolName} requires a full read of the existing file in this run. ` +
          "Read the entire file first, then retry the edit.",
        details: {
          path: snapshot.state.resolvedPath,
          read_offset: previousState.readOffset,
          read_limit: previousState.readLimit,
          read_kind: previousState.readKind,
        },
      });
    }

    if (
      hasTrackedFileStateChanged({
        previousState,
        currentState: snapshot.state,
      })
    ) {
      throw new FileToolError({
        errorCode: "file_changed_since_read",
        message:
          `${toolName} aborted because the file changed after it was read. ` +
          "Read the latest file contents, then retry the edit.",
        details: {
          path: snapshot.state.resolvedPath,
          read_mtime_ms: previousState.mtimeMs,
          current_mtime_ms: snapshot.state.mtimeMs,
        },
      });
    }

    return {
      exists: true,
      resolvedPath: snapshot.resolvedPath,
      currentState: snapshot.state,
      previousState,
    };
  }

  async function writeText(
    toolName: string,
    absolutePath: string,
    content: string,
    options?: { allowCreate?: boolean },
  ): Promise<string> {
    const result = await writeTextDetailed(toolName, absolutePath, content, options);
    return result.resolvedPath;
  }

  async function writeTextDetailed(
    toolName: string,
    absolutePath: string,
    content: string,
    options?: { allowCreate?: boolean },
  ): Promise<{
    resolvedPath: string;
    existedBefore: boolean;
    previousContent?: string;
  }> {
    const mutation = await ensureExistingFileIsFresh(toolName, absolutePath);
    if (!mutation.exists && options?.allowCreate === false) {
      throw new FileToolError({
        errorCode: "file_missing",
        contractCode: "not_found",
        message: `Cannot ${toolName} a missing file: ${absolutePath}`,
        details: { path: absolutePath },
      });
    }

    const targetPath = mutation.resolvedPath;
    const metadata = mutation.currentState?.textMetadata;
    const encoded = encodeTextWithMetadata(content, metadata);
    commitWriteSync({
      toolName,
      targetPath,
      encoded,
      previousState: mutation.previousState,
      allowCreate: options?.allowCreate === true,
    });
    await rememberResolvedPath(targetPath, encoded);
    return {
      resolvedPath: targetPath,
      existedBefore: mutation.exists,
      previousContent: mutation.previousState?.content,
    };
  }

  async function readBufferForEdit(toolName: string, absolutePath: string): Promise<Buffer> {
    const mutation = await ensureExistingFileIsFresh(toolName, absolutePath);
    if (!mutation.exists || !mutation.currentState) {
      throw new FileToolError({
        errorCode: "file_missing",
        contractCode: "not_found",
        message: `Cannot ${toolName} a missing file: ${absolutePath}`,
        details: { path: absolutePath },
      });
    }

    const raw = await fs.readFile(mutation.resolvedPath).catch((err) => {
      const mapped = mapNodeErrorToFileToolError(err, `Cannot read ${mutation.resolvedPath}`, {
        path: mutation.resolvedPath,
      });
      if (mapped) {
        throw mapped;
      }
      throw err;
    });
    const decoded = decodeTextBuffer(raw);
    return Buffer.from(decoded.text, "utf8");
  }

  async function forgetPath(absolutePath: string): Promise<void> {
    const snapshot = await getExistingSnapshot(absolutePath);
    if (snapshot.state) {
      readStateByCanonicalPath.delete(snapshot.state.canonicalPath);
      return;
    }
    const normalizedPath = path.normalize(snapshot.resolvedPath);
    for (const [canonicalPath, tracked] of readStateByCanonicalPath.entries()) {
      if (
        path.normalize(tracked.resolvedPath) === normalizedPath ||
        path.normalize(tracked.canonicalPath) === normalizedPath ||
        canonicalPath === normalizedPath
      ) {
        readStateByCanonicalPath.delete(canonicalPath);
      }
    }
  }

  return {
    recordRead,
    writeText,
    writeTextDetailed,
    readBufferForEdit,
    ensureExistingFileIsFresh,
    rememberResolvedPath,
    seedReadState,
    snapshotReadStates,
    forgetPath,
  };
}

function commitWriteSync(params: {
  toolName: string;
  targetPath: string;
  encoded: Buffer;
  previousState?: TrackedFileState;
  allowCreate: boolean;
}) {
  const currentState = readTrackedStateSync(params.targetPath);
  if (!currentState) {
    if (params.previousState) {
      throw new FileToolError({
        errorCode: "file_changed_since_read",
        message:
          `${params.toolName} aborted because the file changed after it was read. ` +
          "Read the latest file contents, then retry the edit.",
        details: {
          path: params.targetPath,
          read_mtime_ms: params.previousState.mtimeMs,
          current_state: "missing",
        },
      });
    }
    if (!params.allowCreate) {
      throw new FileToolError({
        errorCode: "file_missing",
        contractCode: "not_found",
        message: `Cannot ${params.toolName} a missing file: ${params.targetPath}`,
        details: { path: params.targetPath },
      });
    }
  } else {
    if (!params.previousState) {
      throw new FileToolError({
        errorCode: "file_not_read",
        message:
          `${params.toolName} requires a successful read of the existing file in this run. ` +
          "Read the file first, then retry the edit.",
        details: { path: currentState.resolvedPath },
      });
    }
    if (params.previousState.partial) {
      throw new FileToolError({
        errorCode: "partial_read_only",
        message:
          `${params.toolName} requires a full read of the existing file in this run. ` +
          "Read the entire file first, then retry the edit.",
        details: {
          path: currentState.resolvedPath,
          read_offset: params.previousState.readOffset,
          read_limit: params.previousState.readLimit,
          read_kind: params.previousState.readKind,
        },
      });
    }
    if (
      hasTrackedFileStateChanged({
        previousState: params.previousState,
        currentState,
      })
    ) {
      throw new FileToolError({
        errorCode: "file_changed_since_read",
        message:
          `${params.toolName} aborted because the file changed after it was read. ` +
          "Read the latest file contents, then retry the edit.",
        details: {
          path: currentState.resolvedPath,
          read_mtime_ms: params.previousState.mtimeMs,
          current_mtime_ms: currentState.mtimeMs,
        },
      });
    }
  }

  try {
    const targetDir = path.dirname(params.targetPath);
    const tempPath = path.join(
      targetDir,
      `.openclaw-write-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`,
    );
    try {
      fsSync.writeFileSync(tempPath, params.encoded);
      fsSync.renameSync(tempPath, params.targetPath);
    } finally {
      try {
        if (fsSync.existsSync(tempPath)) {
          fsSync.rmSync(tempPath, { force: true });
        }
      } catch {
        // Best-effort temp cleanup.
      }
    }
  } catch (err) {
    const mapped = mapNodeErrorToFileToolError(err, `Cannot write ${params.targetPath}`, {
      path: params.targetPath,
    });
    if (mapped) {
      throw mapped;
    }
    throw err;
  }
}

function readTrackedStateSync(resolvedPath: string): TrackedFileState | undefined {
  let stat: fsSync.Stats;
  try {
    stat = fsSync.statSync(resolvedPath);
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "code" in (err as Record<string, unknown>) &&
      ((err as NodeJS.ErrnoException).code === "ENOENT" ||
        (err as NodeJS.ErrnoException).code === "ENOTDIR")
    ) {
      return undefined;
    }
    throw err;
  }

  if (!stat.isFile()) {
    throw new FileToolError({
      errorCode: "invalid_file_type",
      contractCode: "invalid_input",
      message: `Path is not a regular file: ${resolvedPath}`,
      details: { path: resolvedPath },
    });
  }

  const raw = fsSync.readFileSync(resolvedPath);
  const canonicalPath =
    fsSync.realpathSync.native?.(resolvedPath) ?? fsSync.realpathSync(resolvedPath);
  const decoded = decodeTextBuffer(raw);
  return {
    resolvedPath,
    canonicalPath,
    readAtMs: Date.now(),
    hash: computeHash(raw),
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    content: decoded.text,
    partial: false,
    readKind: "text",
    textMetadata: decoded.metadata,
  };
}
