import crypto from "node:crypto";
import fs from "node:fs";

const UTF8_BOM = "\uFEFF";
const MAX_JSON_PARSE_CACHE_ENTRIES = 128;
const MAX_JSON_ERROR_FINGERPRINTS = 256;
const MAX_CACHEABLE_JSON_BYTES = 64 * 1024;

type JsonParseCacheEntry =
  | {
      ok: true;
      value: unknown;
    }
  | {
      ok: false;
      message: string;
    };

export type JsonParseResult<T> =
  | {
      ok: true;
      value: T;
      cached: boolean;
      cacheable: boolean;
    }
  | {
      ok: false;
      error: Error;
      cached: boolean;
      cacheable: boolean;
    };

export type JsonLineParseOptions = {
  skipMalformed?: boolean;
};

export type ParsedJsonLines<T> = {
  items: T[];
  skipped: number;
};

const jsonParseCache = new Map<string, JsonParseCacheEntry>();
const invalidJsonFingerprints = new Map<string, true>();

function setLruEntry<T>(map: Map<string, T>, key: string, value: T, maxEntries: number): void {
  if (map.has(key)) {
    map.delete(key);
  }
  map.set(key, value);
  while (map.size > maxEntries) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    map.delete(oldest);
  }
}

function cloneJsonValue<T>(value: T): T {
  if (value === null || value === undefined || typeof value !== "object") {
    return value;
  }
  return structuredClone(value);
}

function normalizeJsonInput(input: string | Uint8Array): string {
  const raw = typeof input === "string" ? input : Buffer.from(input).toString("utf8");
  return stripUtf8Bom(raw);
}

function resolveParseError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error(String(error));
}

function resolveCacheKey(text: string): string | undefined {
  if (Buffer.byteLength(text, "utf8") > MAX_CACHEABLE_JSON_BYTES) {
    return undefined;
  }
  return text;
}

function shouldReportInvalidJson(text: string, errorMessage: string): boolean {
  const fingerprint = crypto
    .createHash("sha256")
    .update(text)
    .update("\0")
    .update(errorMessage)
    .digest("hex");
  if (invalidJsonFingerprints.has(fingerprint)) {
    setLruEntry(invalidJsonFingerprints, fingerprint, true, MAX_JSON_ERROR_FINGERPRINTS);
    return false;
  }
  setLruEntry(invalidJsonFingerprints, fingerprint, true, MAX_JSON_ERROR_FINGERPRINTS);
  return true;
}

export function stripUtf8Bom(raw: string): string {
  return raw.startsWith(UTF8_BOM) ? raw.slice(UTF8_BOM.length) : raw;
}

export function parseJsonWithCache<T>(
  input: string | Uint8Array,
  opts?: {
    onError?: (error: Error) => void;
  },
): JsonParseResult<T> {
  const text = normalizeJsonInput(input);
  const cacheKey = resolveCacheKey(text);
  if (cacheKey !== undefined) {
    const cached = jsonParseCache.get(cacheKey);
    if (cached) {
      setLruEntry(jsonParseCache, cacheKey, cached, MAX_JSON_PARSE_CACHE_ENTRIES);
      if (cached.ok) {
        return {
          ok: true,
          value: cloneJsonValue(cached.value as T),
          cached: true,
          cacheable: true,
        };
      }
      return {
        ok: false,
        error: new Error(cached.message),
        cached: true,
        cacheable: true,
      };
    }
  }

  try {
    const parsed = JSON.parse(text) as T;
    if (cacheKey !== undefined) {
      setLruEntry(
        jsonParseCache,
        cacheKey,
        { ok: true, value: cloneJsonValue(parsed) },
        MAX_JSON_PARSE_CACHE_ENTRIES,
      );
    }
    return {
      ok: true,
      value: parsed,
      cached: false,
      cacheable: cacheKey !== undefined,
    };
  } catch (error) {
    const resolvedError = resolveParseError(error);
    if (opts?.onError && shouldReportInvalidJson(text, resolvedError.message)) {
      opts.onError(resolvedError);
    }
    if (cacheKey !== undefined) {
      setLruEntry(
        jsonParseCache,
        cacheKey,
        { ok: false, message: resolvedError.message },
        MAX_JSON_PARSE_CACHE_ENTRIES,
      );
    }
    return {
      ok: false,
      error: resolvedError,
      cached: false,
      cacheable: cacheKey !== undefined,
    };
  }
}

export function safeParseJson<T>(
  input: string | Uint8Array,
  opts?: {
    onError?: (error: Error) => void;
  },
): T | undefined {
  const parsed = parseJsonWithCache<T>(input, opts);
  return parsed.ok ? parsed.value : undefined;
}

export function parseJsonLines<T>(
  input: string | Uint8Array,
  opts: JsonLineParseOptions = {},
): ParsedJsonLines<T> {
  const text = normalizeJsonInput(input);
  const items: T[] = [];
  let skipped = 0;

  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const parsed = safeParseJson<T>(trimmed);
    if (parsed !== undefined) {
      items.push(parsed);
      continue;
    }
    skipped += 1;
    if (opts.skipMalformed !== true) {
      throw new Error(`Invalid JSONL line at ${index + 1}`);
    }
  }

  return { items, skipped };
}

export function readJsonLinesTail<T>(
  filePath: string,
  maxBytes: number,
  opts: JsonLineParseOptions = {},
): ParsedJsonLines<T> {
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
    return { items: [], skipped: 0 };
  }

  let fd: number | undefined;
  try {
    fd = fs.openSync(filePath, "r");
    const stat = fs.fstatSync(fd);
    if (stat.size <= 0) {
      return { items: [], skipped: 0 };
    }

    const readLength = Math.min(stat.size, Math.floor(maxBytes));
    const readStart = Math.max(0, stat.size - readLength);
    const buffer = Buffer.alloc(readLength);
    fs.readSync(fd, buffer, 0, readLength, readStart);

    let chunk = buffer.toString("utf8");
    if (readStart > 0) {
      const newlineIndex = chunk.indexOf("\n");
      if (newlineIndex === -1) {
        return { items: [], skipped: 0 };
      }
      chunk = chunk.slice(newlineIndex + 1);
    }

    return parseJsonLines<T>(chunk, opts);
  } catch {
    return { items: [], skipped: 0 };
  } finally {
    if (fd !== undefined) {
      fs.closeSync(fd);
    }
  }
}

export function resetJsonParseCachesForTest(): void {
  jsonParseCache.clear();
  invalidJsonFingerprints.clear();
}

export const __test = {
  MAX_CACHEABLE_JSON_BYTES,
  getJsonParseCacheSize: () => jsonParseCache.size,
};
