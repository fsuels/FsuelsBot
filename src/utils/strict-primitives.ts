export const INVALID_STRICT_PRIMITIVE = Symbol("openclaw.invalid-strict-primitive");

export type InvalidStrictPrimitive = typeof INVALID_STRICT_PRIMITIVE;

const STRICT_BOOLEAN_TRUE = new Set(["true", "yes", "on", "1"]);
const STRICT_BOOLEAN_FALSE = new Set(["false", "no", "off", "0"]);
const STRICT_NUMBER_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const STRICT_INTEGER_RE = /^[+-]?\d+$/;

function normalizeToken(raw: string): string | undefined {
  const trimmed = raw.trim();
  return trimmed ? trimmed : undefined;
}

export function isInvalidStrictPrimitive(value: unknown): value is InvalidStrictPrimitive {
  return value === INVALID_STRICT_PRIMITIVE;
}

export function parseBooleanStrict(raw: unknown): boolean | InvalidStrictPrimitive {
  if (typeof raw === "boolean") {
    return raw;
  }
  if (typeof raw === "number") {
    if (raw === 1) {
      return true;
    }
    if (raw === 0) {
      return false;
    }
    return INVALID_STRICT_PRIMITIVE;
  }
  if (typeof raw !== "string") {
    return INVALID_STRICT_PRIMITIVE;
  }
  const normalized = normalizeToken(raw)?.toLowerCase();
  if (!normalized) {
    return INVALID_STRICT_PRIMITIVE;
  }
  if (STRICT_BOOLEAN_TRUE.has(normalized)) {
    return true;
  }
  if (STRICT_BOOLEAN_FALSE.has(normalized)) {
    return false;
  }
  return INVALID_STRICT_PRIMITIVE;
}

export function parseNumberStrict(raw: unknown): number | InvalidStrictPrimitive {
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? raw : INVALID_STRICT_PRIMITIVE;
  }
  if (typeof raw !== "string") {
    return INVALID_STRICT_PRIMITIVE;
  }
  const normalized = normalizeToken(raw);
  if (!normalized || !STRICT_NUMBER_RE.test(normalized)) {
    return INVALID_STRICT_PRIMITIVE;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : INVALID_STRICT_PRIMITIVE;
}

export function parseIntegerStrict(raw: unknown): number | InvalidStrictPrimitive {
  if (typeof raw === "number") {
    return Number.isInteger(raw) && Number.isFinite(raw) ? raw : INVALID_STRICT_PRIMITIVE;
  }
  if (typeof raw !== "string") {
    return INVALID_STRICT_PRIMITIVE;
  }
  const normalized = normalizeToken(raw);
  if (!normalized || !STRICT_INTEGER_RE.test(normalized)) {
    return INVALID_STRICT_PRIMITIVE;
  }
  const parsed = Number(normalized);
  return Number.isInteger(parsed) && Number.isFinite(parsed) ? parsed : INVALID_STRICT_PRIMITIVE;
}
