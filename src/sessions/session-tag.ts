export const SESSION_TAG_MAX_LENGTH = 64;

const HIDDEN_OR_CONTROL_RE = /[\p{Cc}\p{Cf}]/gu;
const WHITESPACE_RE = /\s+/g;

export type ParsedSessionTag =
  | { ok: true; tag: string; strippedHidden: boolean }
  | { ok: false; error: string };

export function parseSessionTag(raw: unknown): ParsedSessionTag {
  if (typeof raw !== "string") {
    return { ok: false, error: "invalid tag: must be a string" };
  }

  const normalized = raw.normalize("NFKC");
  const stripped = normalized.replace(HIDDEN_OR_CONTROL_RE, "");
  const strippedHidden = stripped !== normalized;
  const collapsed = stripped.replace(WHITESPACE_RE, " ").trim();

  if (!collapsed) {
    return { ok: false, error: "invalid tag: empty" };
  }

  if (collapsed.length > SESSION_TAG_MAX_LENGTH) {
    return {
      ok: false,
      error: `invalid tag: too long (max ${SESSION_TAG_MAX_LENGTH})`,
    };
  }

  return { ok: true, tag: collapsed, strippedHidden };
}
