import type { Stats } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import { StringDecoder } from "node:string_decoder";

const FAST_PATH_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_STREAM_CHUNK_BYTES = 64 * 1024;

export const MAX_SCAN_BYTES = 8 * 1024 * 1024;

export class FileTooLargeError extends Error {
  readonly code = "FILE_TOO_LARGE";
  readonly filePath: string;
  readonly maxBytes: number;
  readonly actualBytes?: number;

  constructor(params: {
    filePath: string;
    maxBytes: number;
    actualBytes?: number;
    message?: string;
  }) {
    super(
      params.message ??
        `File content exceeded ${params.maxBytes} bytes while reading ${params.filePath}.`,
    );
    this.name = "FileTooLargeError";
    this.filePath = params.filePath;
    this.maxBytes = params.maxBytes;
    this.actualBytes = params.actualBytes;
  }
}

export type FileRangeReadResult = {
  content: string;
  lineCount: number;
  totalLines: number;
  totalBytes: number;
  readBytes: number;
  mtimeMs: number;
  truncatedByBytes?: boolean;
  firstExcludedLineBytes?: number;
};

export type EditContextReadResult = {
  content: string;
  lineOffset: number;
  truncated: boolean;
};

type CapturedRange = {
  lines: string[];
  bytes: number;
  truncatedByBytes: boolean;
  firstExcludedLineBytes?: number;
};

function assertNotAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new Error("Operation aborted");
  }
}

function stripUtf8Bom(text: string): string {
  return text.startsWith("\uFEFF") ? text.slice(1) : text;
}

function normalizeText(text: string): string {
  return stripUtf8Bom(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function splitNormalizedLines(text: string): string[] {
  if (!text) {
    return [];
  }
  return text.split("\n");
}

function byteLengthUtf8(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

function createCapturedRange(): CapturedRange {
  return {
    lines: [],
    bytes: 0,
    truncatedByBytes: false,
  };
}

function tryCaptureLine(params: {
  line: string;
  captured: CapturedRange;
  maxBytes?: number;
  truncateOnByteLimit: boolean;
  filePath: string;
}) {
  const prefixBytes = params.captured.lines.length > 0 ? 1 : 0;
  const lineBytes = byteLengthUtf8(params.line);
  const nextBytes = params.captured.bytes + prefixBytes + lineBytes;
  if (params.maxBytes === undefined || nextBytes <= params.maxBytes) {
    params.captured.lines.push(params.line);
    params.captured.bytes = nextBytes;
    return;
  }
  if (!params.truncateOnByteLimit) {
    throw new FileTooLargeError({
      filePath: params.filePath,
      maxBytes: params.maxBytes,
      actualBytes: nextBytes,
    });
  }
  params.captured.truncatedByBytes = true;
  if (params.captured.firstExcludedLineBytes === undefined) {
    params.captured.firstExcludedLineBytes = lineBytes;
  }
}

function buildRangeResult(params: {
  lines: string[];
  offset: number;
  maxLines?: number;
  maxBytes?: number;
  truncateOnByteLimit: boolean;
  filePath: string;
  totalBytes: number;
  readBytes: number;
  mtimeMs: number;
}): FileRangeReadResult {
  const captured = createCapturedRange();
  const startIndex = Math.max(0, params.offset);
  const endIndex =
    params.maxLines === undefined
      ? params.lines.length
      : Math.min(params.lines.length, startIndex + params.maxLines);

  for (let index = startIndex; index < endIndex; index += 1) {
    tryCaptureLine({
      line: params.lines[index] ?? "",
      captured,
      maxBytes: params.maxBytes,
      truncateOnByteLimit: params.truncateOnByteLimit,
      filePath: params.filePath,
    });
    if (captured.truncatedByBytes) {
      break;
    }
  }

  return {
    content: captured.lines.join("\n"),
    lineCount: captured.lines.length,
    totalLines: params.lines.length,
    totalBytes: params.totalBytes,
    readBytes: params.readBytes,
    mtimeMs: params.mtimeMs,
    ...(captured.truncatedByBytes ? { truncatedByBytes: true } : {}),
    ...(captured.firstExcludedLineBytes !== undefined
      ? { firstExcludedLineBytes: captured.firstExcludedLineBytes }
      : {}),
  };
}

async function readStat(filePath: string): Promise<Stats> {
  return await fs.stat(filePath);
}

async function readFastPath(params: {
  filePath: string;
  stat: Stats;
  offset: number;
  maxLines?: number;
  maxBytes?: number;
  signal?: AbortSignal;
  truncateOnByteLimit: boolean;
}): Promise<FileRangeReadResult> {
  assertNotAborted(params.signal);
  const raw = await fs.readFile(params.filePath, params.signal ? { signal: params.signal } : {});
  assertNotAborted(params.signal);
  const normalized = normalizeText(raw.toString("utf8"));
  return buildRangeResult({
    lines: splitNormalizedLines(normalized),
    offset: params.offset,
    maxLines: params.maxLines,
    maxBytes: params.maxBytes,
    truncateOnByteLimit: params.truncateOnByteLimit,
    filePath: params.filePath,
    totalBytes: params.stat.size,
    readBytes: raw.byteLength,
    mtimeMs: params.stat.mtimeMs,
  });
}

async function readStreamingPath(params: {
  filePath: string;
  stat: Stats;
  offset: number;
  maxLines?: number;
  maxBytes?: number;
  signal?: AbortSignal;
  truncateOnByteLimit: boolean;
}): Promise<FileRangeReadResult> {
  assertNotAborted(params.signal);
  const captured = createCapturedRange();
  const decoder = new StringDecoder("utf8");
  let readBytes = 0;
  let totalLines = 0;
  let currentLine = "";
  let endedWithNewline = false;
  let pendingCR = false;
  let sawAnyText = false;

  const captureIfInRange = (line: string) => {
    const lineIndex = totalLines;
    totalLines += 1;
    if (lineIndex < params.offset) {
      return;
    }
    if (params.maxLines !== undefined && lineIndex >= params.offset + params.maxLines) {
      return;
    }
    tryCaptureLine({
      line,
      captured,
      maxBytes: params.maxBytes,
      truncateOnByteLimit: params.truncateOnByteLimit,
      filePath: params.filePath,
    });
  };

  const processText = (text: string) => {
    let normalized = text;
    if (!sawAnyText) {
      normalized = stripUtf8Bom(normalized);
      sawAnyText = true;
    }
    for (let index = 0; index < normalized.length; index += 1) {
      const char = normalized[index] ?? "";
      if (pendingCR) {
        pendingCR = false;
        endedWithNewline = true;
        captureIfInRange(currentLine);
        currentLine = "";
        if (char === "\n") {
          continue;
        }
      }
      if (char === "\r") {
        pendingCR = true;
        continue;
      }
      if (char === "\n") {
        endedWithNewline = true;
        captureIfInRange(currentLine);
        currentLine = "";
        continue;
      }
      currentLine += char;
      endedWithNewline = false;
    }
  };

  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(params.filePath, {
      highWaterMark: DEFAULT_STREAM_CHUNK_BYTES,
    });

    const cleanup = () => {
      params.signal?.removeEventListener("abort", onAbort);
    };

    const onAbort = () => {
      stream.destroy(new Error("Operation aborted"));
    };

    params.signal?.addEventListener("abort", onAbort, { once: true });

    stream.on("data", (chunk: Buffer | string) => {
      try {
        assertNotAborted(params.signal);
        const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
        readBytes += buffer.byteLength;
        processText(decoder.write(buffer));
      } catch (error) {
        stream.destroy(error instanceof Error ? error : new Error(String(error)));
      }
    });
    stream.on("error", (error) => {
      cleanup();
      reject(error);
    });
    stream.on("end", () => {
      try {
        processText(decoder.end());
        if (pendingCR) {
          pendingCR = false;
          endedWithNewline = true;
          captureIfInRange(currentLine);
          currentLine = "";
        }
        if (currentLine.length > 0 || endedWithNewline) {
          captureIfInRange(currentLine);
        }
        cleanup();
        resolve();
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
  });

  return {
    content: captured.lines.join("\n"),
    lineCount: captured.lines.length,
    totalLines,
    totalBytes: params.stat.size,
    readBytes,
    mtimeMs: params.stat.mtimeMs,
    ...(captured.truncatedByBytes ? { truncatedByBytes: true } : {}),
    ...(captured.firstExcludedLineBytes !== undefined
      ? { firstExcludedLineBytes: captured.firstExcludedLineBytes }
      : {}),
  };
}

export async function readFileInRange(
  filePath: string,
  offset = 0,
  maxLines?: number,
  maxBytes?: number,
  signal?: AbortSignal,
  options?: {
    truncateOnByteLimit?: boolean;
  },
): Promise<FileRangeReadResult> {
  const stat = await readStat(filePath);
  const truncateOnByteLimit = options?.truncateOnByteLimit ?? false;
  const safeOffset = Math.max(0, Math.floor(offset));
  const safeMaxLines =
    typeof maxLines === "number" && Number.isFinite(maxLines)
      ? Math.max(0, Math.floor(maxLines))
      : undefined;
  if (stat.isFile() && stat.size <= FAST_PATH_MAX_BYTES) {
    return await readFastPath({
      filePath,
      stat,
      offset: safeOffset,
      maxLines: safeMaxLines,
      maxBytes,
      signal,
      truncateOnByteLimit,
    });
  }
  return await readStreamingPath({
    filePath,
    stat,
    offset: safeOffset,
    maxLines: safeMaxLines,
    maxBytes,
    signal,
    truncateOnByteLimit,
  });
}

export async function readCapped(
  handle: FileHandle,
  maxBytes = MAX_SCAN_BYTES,
  signal?: AbortSignal,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  const chunk = Buffer.allocUnsafe(DEFAULT_STREAM_CHUNK_BYTES);
  const handlePath =
    typeof (handle as { path?: unknown }).path === "string"
      ? ((handle as { path?: string }).path as string)
      : "<file>";

  for (;;) {
    assertNotAborted(signal);
    const result = await handle.read(chunk, 0, chunk.length, null);
    if (!result.bytesRead) {
      break;
    }
    totalBytes += result.bytesRead;
    if (totalBytes > maxBytes) {
      throw new FileTooLargeError({
        filePath: handlePath,
        maxBytes,
        actualBytes: totalBytes,
      });
    }
    chunks.push(Buffer.from(chunk.subarray(0, result.bytesRead)));
  }

  return Buffer.concat(chunks);
}

export async function readEditContext(
  filePath: string,
  needle: string,
  contextLines = 3,
  signal?: AbortSignal,
  options?: {
    maxScanBytes?: number;
  },
): Promise<EditContextReadResult | null> {
  const trimmedNeedle = normalizeText(needle);
  if (!trimmedNeedle) {
    return null;
  }

  const maxScanBytes = options?.maxScanBytes ?? MAX_SCAN_BYTES;
  const decoder = new StringDecoder("utf8");
  let accumulated = "";
  let readBytes = 0;
  let pendingCR = false;
  let truncated = false;
  let sawAnyText = false;

  const appendText = (text: string) => {
    let normalized = text;
    if (!sawAnyText) {
      normalized = stripUtf8Bom(normalized);
      sawAnyText = true;
    }
    for (let index = 0; index < normalized.length; index += 1) {
      const char = normalized[index] ?? "";
      if (pendingCR) {
        pendingCR = false;
        accumulated += "\n";
        if (char === "\n") {
          continue;
        }
      }
      if (char === "\r") {
        pendingCR = true;
        continue;
      }
      accumulated += char === "\n" ? "\n" : char;
    }
  };

  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath, {
      highWaterMark: DEFAULT_STREAM_CHUNK_BYTES,
    });

    const cleanup = () => {
      signal?.removeEventListener("abort", onAbort);
    };

    const onAbort = () => {
      stream.destroy(new Error("Operation aborted"));
    };

    signal?.addEventListener("abort", onAbort, { once: true });

    stream.on("data", (chunk: Buffer | string) => {
      try {
        assertNotAborted(signal);
        const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
        if (readBytes >= maxScanBytes) {
          truncated = true;
          stream.destroy();
          return;
        }
        const remaining = maxScanBytes - readBytes;
        const slice = buffer.byteLength > remaining ? buffer.subarray(0, remaining) : buffer;
        readBytes += slice.byteLength;
        appendText(decoder.write(slice));
        if (slice.byteLength < buffer.byteLength) {
          truncated = true;
          stream.destroy();
        }
      } catch (error) {
        stream.destroy(error instanceof Error ? error : new Error(String(error)));
      }
    });
    stream.on("error", (error) => {
      if (truncated && (error as NodeJS.ErrnoException).code === undefined) {
        cleanup();
        resolve();
        return;
      }
      cleanup();
      reject(error);
    });
    stream.on("end", () => {
      try {
        appendText(decoder.end());
        if (pendingCR) {
          accumulated += "\n";
          pendingCR = false;
        }
        cleanup();
        resolve();
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
    stream.on("close", () => {
      cleanup();
      resolve();
    });
  });

  appendText(decoder.end());
  if (pendingCR) {
    accumulated += "\n";
    pendingCR = false;
  }

  const matchIndex = accumulated.indexOf(trimmedNeedle);
  if (matchIndex === -1) {
    return null;
  }

  const lines = splitNormalizedLines(accumulated);
  let lineStartIndex = 0;
  let currentLine = 1;
  let matchStartLine = 1;
  let matchEndLine = 1;
  const matchEndIndex = Math.max(matchIndex, matchIndex + trimmedNeedle.length - 1);

  for (const line of lines) {
    const lineEndIndex = lineStartIndex + line.length;
    if (matchIndex >= lineStartIndex && matchIndex <= lineEndIndex) {
      matchStartLine = currentLine;
    }
    if (matchEndIndex >= lineStartIndex && matchEndIndex <= lineEndIndex) {
      matchEndLine = currentLine;
      break;
    }
    lineStartIndex = lineEndIndex + 1;
    currentLine += 1;
  }

  const startLine = Math.max(1, matchStartLine - Math.max(0, contextLines));
  const endLine = Math.min(lines.length, matchEndLine + Math.max(0, contextLines));
  return {
    content: lines.slice(startLine - 1, endLine).join("\n"),
    lineOffset: startLine,
    truncated: truncated || startLine > 1 || endLine < lines.length,
  };
}
