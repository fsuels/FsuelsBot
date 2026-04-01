import type {
  ExternalOriginContext,
  ExternalOriginSource,
  ExternalOriginTrustLevel,
} from "../config/sessions.js";

const VALID_SOURCES = new Set<ExternalOriginSource>([
  "interactive",
  "browser-link",
  "os-protocol",
  "editor-extension",
  "mcp",
  "imported-text",
  "other",
]);

const VALID_TRUST_LEVELS = new Set<ExternalOriginTrustLevel>(["interactive", "external"]);
const MAX_RAW_URI_LENGTH = 4_096;
const MAX_PAYLOAD_LENGTH = 20_000;

function containsAsciiControl(value: string): boolean {
  return /[\x00-\x1f\x7f]/.test(value);
}

function normalizeTrimmedString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength || containsAsciiControl(trimmed)) {
    return undefined;
  }
  return trimmed;
}

export function normalizeExternalOrigin(input: unknown): ExternalOriginContext | undefined {
  if (!input || typeof input !== "object") {
    return undefined;
  }
  const obj = input as Record<string, unknown>;
  const sourceRaw = normalizeTrimmedString(obj.source, 64) ?? "other";
  const source: ExternalOriginSource = VALID_SOURCES.has(sourceRaw as ExternalOriginSource)
    ? (sourceRaw as ExternalOriginSource)
    : "other";
  const receivedAt =
    typeof obj.receivedAt === "number" && Number.isFinite(obj.receivedAt) && obj.receivedAt >= 0
      ? Math.floor(obj.receivedAt)
      : Date.now();
  const payloadLength =
    typeof obj.payloadLength === "number" &&
    Number.isFinite(obj.payloadLength) &&
    obj.payloadLength >= 0 &&
    obj.payloadLength <= MAX_PAYLOAD_LENGTH
      ? Math.floor(obj.payloadLength)
      : undefined;
  const trustRaw = normalizeTrimmedString(obj.trustLevel, 32);
  const trustLevel: ExternalOriginTrustLevel = VALID_TRUST_LEVELS.has(
    trustRaw as ExternalOriginTrustLevel,
  )
    ? (trustRaw as ExternalOriginTrustLevel)
    : source === "interactive"
      ? "interactive"
      : "external";
  const rawUri = normalizeTrimmedString(obj.rawUri, MAX_RAW_URI_LENGTH);

  return {
    source,
    rawUri,
    receivedAt,
    payloadLength,
    trustLevel,
  };
}
