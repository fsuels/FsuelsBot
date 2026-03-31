const NDJSON_UNSAFE_CODEPOINTS = /[\u2028\u2029]/g;

export function safeNdjsonStringify(value: unknown): string {
  return JSON.stringify(value).replace(NDJSON_UNSAFE_CODEPOINTS, (char) =>
    char === "\u2028" ? "\\u2028" : "\\u2029",
  );
}
