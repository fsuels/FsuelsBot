import { parseBooleanValue } from "../utils/boolean.js";

const MAX_UNICODE_SANITIZE_PASSES = 4;
const DANGEROUS_UNICODE_CATEGORY_RE = /[\p{Cf}\p{Co}\p{Cs}]/u;
const SEMANTIC_NUMBER_RE = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/;

type SchemaRecord = Record<string, unknown>;

export type HardenedToolInputStats = {
  sanitizedStringCount: number;
  sanitizedKeyCount: number;
  strippedCodePointCount: number;
  coercedBooleanCount: number;
  coercedNumberCount: number;
};

export type HardenedToolInputResult<T = unknown> = {
  value: T;
  stats: HardenedToolInputStats;
};

type SanitizeUnicodeStringResult = {
  value: string;
  changed: boolean;
  strippedCodePointCount: number;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isSchemaRecord(value: unknown): value is SchemaRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNoncharacterCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0xfdd0 && codePoint <= 0xfdef) ||
    (codePoint <= 0x10ffff && (codePoint & 0xfffe) === 0xfffe)
  );
}

function shouldStripUnicodeCodePoint(char: string, codePoint: number): boolean {
  if (codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d) {
    return false;
  }
  if ((codePoint >= 0x00 && codePoint <= 0x1f) || (codePoint >= 0x7f && codePoint <= 0x9f)) {
    return true;
  }
  if (DANGEROUS_UNICODE_CATEGORY_RE.test(char)) {
    return true;
  }
  return isNoncharacterCodePoint(codePoint);
}

function stripDangerousUnicode(value: string): SanitizeUnicodeStringResult {
  let strippedCodePointCount = 0;
  let next = "";
  for (const char of value) {
    const codePoint = char.codePointAt(0);
    if (codePoint === undefined) {
      next += char;
      continue;
    }
    if (shouldStripUnicodeCodePoint(char, codePoint)) {
      strippedCodePointCount += 1;
      continue;
    }
    next += char;
  }
  return {
    value: next,
    changed: strippedCodePointCount > 0 || next !== value,
    strippedCodePointCount,
  };
}

export function sanitizeUnicodeString(value: string): SanitizeUnicodeStringResult {
  let current = value;
  let totalStrippedCodePoints = 0;
  const seen = new Set<string>();

  for (let pass = 0; pass < MAX_UNICODE_SANITIZE_PASSES; pass += 1) {
    if (seen.has(current)) {
      throw new Error("Unicode sanitization entered a non-converging loop.");
    }
    seen.add(current);

    const normalized = current.normalize("NFKC");
    const stripped = stripDangerousUnicode(normalized);
    totalStrippedCodePoints += stripped.strippedCodePointCount;

    if (stripped.value === current) {
      return {
        value: stripped.value,
        changed: stripped.value !== value || totalStrippedCodePoints > 0,
        strippedCodePointCount: totalStrippedCodePoints,
      };
    }
    current = stripped.value;
  }

  throw new Error("Unicode sanitization exceeded the maximum number of rewrite passes.");
}

export function coerceSemanticBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  return parseBooleanValue(value);
}

export function coerceSemanticNumber(
  value: unknown,
  options: { integer?: boolean } = {},
): number | undefined {
  const { integer = false } = options;
  if (typeof value === "number" && Number.isFinite(value)) {
    if (integer && !Number.isInteger(value)) {
      return undefined;
    }
    return value;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed || !SEMANTIC_NUMBER_RE.test(trimmed)) {
    return undefined;
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  if (integer && !Number.isInteger(parsed)) {
    return undefined;
  }
  return parsed;
}

function getSchemaTypes(schema: unknown): string[] {
  if (!isSchemaRecord(schema)) {
    return [];
  }
  const raw = schema.type;
  if (typeof raw === "string") {
    return [raw];
  }
  if (Array.isArray(raw)) {
    return raw.filter((entry): entry is string => typeof entry === "string");
  }
  return [];
}

function maybeCoercePrimitive(
  schema: unknown,
  value: unknown,
  stats: HardenedToolInputStats,
): unknown {
  const types = getSchemaTypes(schema);
  if (types.length === 0) {
    return value;
  }
  const uniqueTypes = Array.from(new Set(types));
  if (uniqueTypes.length === 1 && uniqueTypes[0] === "boolean") {
    const coerced = coerceSemanticBoolean(value);
    if (coerced !== undefined && coerced !== value) {
      stats.coercedBooleanCount += 1;
      return coerced;
    }
    return value;
  }
  if (
    uniqueTypes.every((type) => type === "number" || type === "integer") &&
    uniqueTypes.some((type) => type === "number" || type === "integer")
  ) {
    const coerced = coerceSemanticNumber(value, {
      integer: uniqueTypes.every((type) => type === "integer"),
    });
    if (coerced !== undefined && coerced !== value) {
      stats.coercedNumberCount += 1;
      return coerced;
    }
    return value;
  }
  return value;
}

function hardenToolInputValue(
  schema: unknown,
  value: unknown,
  stats: HardenedToolInputStats,
  seen: WeakMap<object, unknown>,
): unknown {
  if (typeof value === "string") {
    const sanitized = sanitizeUnicodeString(value);
    if (sanitized.changed) {
      stats.sanitizedStringCount += 1;
      stats.strippedCodePointCount += sanitized.strippedCodePointCount;
    }
    return maybeCoercePrimitive(schema, sanitized.value, stats);
  }

  if (Array.isArray(value)) {
    const cached = seen.get(value);
    if (cached) {
      return cached;
    }
    const next: unknown[] = [];
    seen.set(value, next);
    const itemSchema = isSchemaRecord(schema) ? schema.items : undefined;
    for (const entry of value) {
      next.push(hardenToolInputValue(itemSchema, entry, stats, seen));
    }
    return next;
  }

  if (!isPlainObject(value)) {
    return maybeCoercePrimitive(schema, value, stats);
  }

  const cached = seen.get(value);
  if (cached) {
    return cached;
  }

  const next: Record<string, unknown> = {};
  seen.set(value, next);

  const properties =
    isSchemaRecord(schema) && isSchemaRecord(schema.properties) ? schema.properties : undefined;
  const additionalProperties =
    isSchemaRecord(schema) && isSchemaRecord(schema.additionalProperties)
      ? schema.additionalProperties
      : undefined;

  for (const [rawKey, rawValue] of Object.entries(value)) {
    const sanitizedKey = sanitizeUnicodeString(rawKey);
    if (sanitizedKey.changed) {
      stats.sanitizedKeyCount += 1;
      stats.strippedCodePointCount += sanitizedKey.strippedCodePointCount;
    }
    const nextKey = sanitizedKey.value;
    if (!nextKey) {
      throw new Error(`Tool input key "${rawKey}" became empty after Unicode sanitization.`);
    }
    if (Object.prototype.hasOwnProperty.call(next, nextKey)) {
      throw new Error(
        `Tool input keys "${rawKey}" and "${nextKey}" collide after Unicode sanitization.`,
      );
    }
    const propertySchema = properties?.[nextKey] ?? properties?.[rawKey] ?? additionalProperties;
    next[nextKey] = hardenToolInputValue(propertySchema, rawValue, stats, seen);
  }

  return next;
}

export function hardenToolInputForSchema<T = unknown>(
  schema: unknown,
  value: T,
): HardenedToolInputResult<T> {
  const stats: HardenedToolInputStats = {
    sanitizedStringCount: 0,
    sanitizedKeyCount: 0,
    strippedCodePointCount: 0,
    coercedBooleanCount: 0,
    coercedNumberCount: 0,
  };
  const hardened = hardenToolInputValue(schema, value, stats, new WeakMap()) as T;
  return {
    value: hardened,
    stats,
  };
}
