/**
 * Helper functions for tool card rendering.
 */

import { PREVIEW_MAX_CHARS, PREVIEW_MAX_LINES } from "./constants.ts";

const MAX_JSON_CHARS = 200_000;
const DOMINANT_STRING_CHARS = 200;
const DOMINANT_MULTILINE_CHARS = 50;
const FLAT_OBJECT_MAX_KEYS = 12;
const FLAT_OBJECT_MAX_CHARS = 5_000;
const NESTED_VALUE_MAX_CHARS = 120;
const URL_RE = /\bhttps?:\/\/[^\s<>()]+/g;
const MESSAGE_LIKE_SUCCESS_TOOLS = new Set([
  "message",
  "telegram",
  "discord",
  "slack",
  "signal",
  "whatsapp",
  "imessage",
  "line",
]);

const graphemeSegmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

const WIDE_CODE_POINT_RANGES: Array<[number, number]> = [
  [0x1100, 0x115f],
  [0x2329, 0x232a],
  [0x2e80, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe10, 0xfe19],
  [0xfe30, 0xfe6f],
  [0xff01, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f300, 0x1f64f],
  [0x1f680, 0x1f6ff],
  [0x1f900, 0x1f9ff],
  [0x1fa70, 0x1faff],
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function splitGraphemes(value: string): string[] {
  if (!graphemeSegmenter) {
    return Array.from(value);
  }
  try {
    return Array.from(graphemeSegmenter.segment(value), (segment) => segment.segment);
  } catch {
    return Array.from(value);
  }
}

function codePointWidth(codePoint: number): number {
  if (codePoint === 0x200d || codePoint === 0xfe0f) {
    return 0;
  }
  if (
    (codePoint >= 0x0300 && codePoint <= 0x036f) ||
    (codePoint >= 0x1ab0 && codePoint <= 0x1aff) ||
    (codePoint >= 0x1dc0 && codePoint <= 0x1dff) ||
    (codePoint >= 0x20d0 && codePoint <= 0x20ff) ||
    (codePoint >= 0xfe20 && codePoint <= 0xfe2f)
  ) {
    return 0;
  }
  return WIDE_CODE_POINT_RANGES.some(([start, end]) => codePoint >= start && codePoint <= end)
    ? 2
    : 1;
}

function graphemeWidth(grapheme: string): number {
  let width = 0;
  for (const symbol of Array.from(grapheme)) {
    const codePoint = symbol.codePointAt(0);
    if (codePoint === undefined) {
      continue;
    }
    width = Math.max(width, codePointWidth(codePoint));
  }
  return width;
}

function visibleWidth(text: string): number {
  let width = 0;
  for (const symbol of splitGraphemes(text)) {
    if (symbol === "\n") {
      continue;
    }
    width += graphemeWidth(symbol);
  }
  return width;
}

function truncateToDisplayWidth(
  text: string,
  maxWidth: number,
): { text: string; truncated: boolean } {
  if (maxWidth <= 0) {
    return { text: "", truncated: text.length > 0 };
  }
  let width = 0;
  let out = "";
  for (const symbol of splitGraphemes(text)) {
    const symbolWidth = symbol === "\n" ? 0 : graphemeWidth(symbol);
    if (width + symbolWidth > maxWidth) {
      return { text: out, truncated: true };
    }
    out += symbol;
    width += symbolWidth;
  }
  return { text: out, truncated: false };
}

function markdownLineBreaks(text: string): string {
  return text.replace(/\n/g, "  \n");
}

function linkifyUrls(text: string): string {
  return text.replace(URL_RE, (url) => `<${url}>`);
}

function compactNestedValue(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return "null";
  }
  if (typeof value === "string") {
    const normalized = value.replace(/\s+/g, " ").trim();
    if (!normalized) {
      return '""';
    }
    if (normalized.length > NESTED_VALUE_MAX_CHARS) {
      return undefined;
    }
    return linkifyUrls(normalized);
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  try {
    const serialized = JSON.stringify(value);
    if (!serialized || serialized.length > NESTED_VALUE_MAX_CHARS) {
      return undefined;
    }
    return serialized;
  } catch {
    return undefined;
  }
}

function formatRows(rows: Array<{ key: string; value: string }>, markdown: boolean): string {
  const width = rows.reduce((max, row) => Math.max(max, row.key.length), 0);
  const text = rows.map((row) => `${row.key.padEnd(width)}: ${row.value}`).join("\n");
  return markdown ? markdownLineBreaks(text) : text;
}

function isDominantString(value: string): boolean {
  return (
    value.length > DOMINANT_STRING_CHARS ||
    (value.includes("\n") && value.length > DOMINANT_MULTILINE_CHARS)
  );
}

function renderJsonFallback(parsed: unknown, markdown: boolean): string {
  const pretty = JSON.stringify(parsed, null, 2);
  return markdown ? `\`\`\`json\n${pretty}\n\`\`\`` : pretty;
}

function renderJsonObject(
  record: Record<string, unknown>,
  sourceText: string,
  markdown: boolean,
): string {
  const entries = Object.entries(record);
  const prettyFallback = renderJsonFallback(record, markdown);

  const dominantKeys = entries
    .filter(([, value]) => typeof value === "string" && isDominantString(value))
    .map(([key]) => key);

  if (dominantKeys.length === 1) {
    const dominantKey = dominantKeys[0];
    const metadata: Array<{ key: string; value: string }> = [];
    for (const [key, value] of entries) {
      if (key === dominantKey) {
        continue;
      }
      const compact = compactNestedValue(value);
      if (!compact) {
        return prettyFallback;
      }
      metadata.push({ key, value: compact });
    }
    const body = typeof record[dominantKey] === "string" ? linkifyUrls(record[dominantKey]) : "";
    const metadataText = metadata.length > 0 ? `${formatRows(metadata, markdown)}\n\n` : "";
    const rendered = `${metadataText}${body}`;
    return markdown ? markdownLineBreaks(rendered) : rendered;
  }

  if (dominantKeys.length > 1) {
    return prettyFallback;
  }

  if (entries.length > FLAT_OBJECT_MAX_KEYS || sourceText.length > FLAT_OBJECT_MAX_CHARS) {
    return prettyFallback;
  }

  const rows: Array<{ key: string; value: string }> = [];
  for (const [key, value] of entries) {
    const compact = compactNestedValue(value);
    if (!compact) {
      return prettyFallback;
    }
    rows.push({ key, value: compact });
  }

  if (rows.length === 0) {
    return prettyFallback;
  }

  return formatRows(rows, markdown);
}

function renderJsonString(text: string, markdown: boolean, toolName?: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return text;
  }
  if (trimmed.length > MAX_JSON_CHARS) {
    return linkifyUrls(text);
  }
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return linkifyUrls(text);
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      return renderJsonFallback(parsed, markdown);
    }
    if (isPlainObject(parsed)) {
      const compactSuccess = renderCompactSuccess(parsed, toolName);
      if (compactSuccess) {
        return compactSuccess;
      }
      return renderJsonObject(parsed, trimmed, markdown);
    }
    return renderJsonFallback(parsed, markdown);
  } catch {
    return linkifyUrls(text);
  }
}

function renderProgress(value: unknown): string | null {
  const details = isPlainObject(value)
    ? isPlainObject(value.details)
      ? value.details
      : value
    : null;
  if (!details) {
    return null;
  }
  const progress =
    typeof details.progress === "number"
      ? details.progress
      : typeof details.completed === "number"
        ? details.completed
        : undefined;
  const total =
    typeof details.total === "number"
      ? details.total
      : typeof details.totalSteps === "number"
        ? details.totalSteps
        : undefined;
  if (
    typeof progress === "number" &&
    Number.isFinite(progress) &&
    typeof total === "number" &&
    Number.isFinite(total) &&
    total > 0
  ) {
    return `Processing… ${progress}/${total} (${Math.round((progress / total) * 100)}%)`;
  }
  if (typeof details.progressMessage === "string" && details.progressMessage.trim()) {
    return linkifyUrls(details.progressMessage.trim());
  }
  if (typeof details.label === "string" && details.label.trim()) {
    return linkifyUrls(details.label.trim());
  }
  if (typeof details.progress === "string" && details.progress.trim()) {
    return `Processing… ${linkifyUrls(details.progress.trim())}`;
  }
  if (typeof details.status === "string" && details.status.trim().toLowerCase() === "running") {
    return "Running…";
  }
  return null;
}

function isSuccessLike(value: unknown): boolean {
  if (value === true) {
    return true;
  }
  if (typeof value !== "string") {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return (
    normalized === "ok" ||
    normalized === "success" ||
    normalized === "sent" ||
    normalized === "queued" ||
    normalized === "accepted" ||
    normalized === "completed"
  );
}

function renderCompactSuccess(
  value: Record<string, unknown>,
  toolName: string | undefined,
): string | null {
  if (!toolName || !MESSAGE_LIKE_SUCCESS_TOOLS.has(toolName.trim().toLowerCase())) {
    return null;
  }
  const details = isPlainObject(value.details) ? value.details : value;
  if (!isPlainObject(details)) {
    return null;
  }

  const success =
    isSuccessLike(details.status) ||
    isSuccessLike(details.ok) ||
    isSuccessLike(details.success) ||
    isSuccessLike(details.result);
  if (!success) {
    return null;
  }

  const destination =
    (typeof details.to === "string" && details.to.trim()) ||
    (typeof details.destination === "string" && details.destination.trim()) ||
    (typeof details.url === "string" && details.url.trim()) ||
    "";
  if (!destination) {
    return null;
  }

  const channel = typeof details.channel === "string" ? details.channel.trim() : "";
  const messageId = typeof details.messageId === "string" ? details.messageId.trim() : "";
  const via = channel ? ` via ${channel}` : "";
  const receipt = messageId ? ` (${messageId})` : "";
  return `Sent to ${linkifyUrls(destination)}${via}${receipt}`;
}

function renderReadSummary(value: Record<string, unknown>, toolName?: string): string | null {
  if (toolName?.trim().toLowerCase() !== "read") {
    return null;
  }
  if (!isPlainObject(value.details)) {
    return null;
  }
  const details = value.details;
  const kind = typeof details.kind === "string" ? details.kind : "";
  const filePath = typeof details.path === "string" ? details.path.trim() : "";
  if (!kind || !filePath) {
    return null;
  }

  if (kind === "text") {
    const numLines = typeof details.numLines === "number" ? details.numLines : undefined;
    const startLine = typeof details.startLine === "number" ? details.startLine : undefined;
    const endLine = typeof details.endLine === "number" ? details.endLine : undefined;
    const totalLines = typeof details.totalLines === "number" ? details.totalLines : undefined;
    if (
      numLines === undefined ||
      startLine === undefined ||
      endLine === undefined ||
      totalLines === undefined
    ) {
      return null;
    }
    const noun = numLines === 1 ? "line" : "lines";
    return `Read ${numLines} ${noun} from ${filePath} (${startLine}-${endLine} of ${totalLines})`;
  }

  if (kind === "empty") {
    return `Read empty file ${filePath}`;
  }

  if (kind === "past_eof") {
    const requestedOffset =
      typeof details.requestedOffset === "number" ? details.requestedOffset : undefined;
    const totalLines = typeof details.totalLines === "number" ? details.totalLines : undefined;
    if (requestedOffset === undefined || totalLines === undefined) {
      return null;
    }
    return `Read past EOF for ${filePath} (offset ${requestedOffset}, total ${totalLines} lines)`;
  }

  if (kind === "image") {
    const mimeType = typeof details.mimeType === "string" ? details.mimeType : "image";
    return `Read image ${filePath} (${mimeType})`;
  }

  return null;
}

function renderUnserializableToolOutput(markdown: boolean): string {
  const fallback = { error: "Unable to render tool output" };
  return markdown
    ? `\`\`\`json\n${JSON.stringify(fallback, null, 2)}\n\`\`\``
    : JSON.stringify(fallback, null, 2);
}

/**
 * Render a tool output payload into plain text or markdown.
 */
export function renderToolOutputValue(
  value: unknown,
  options: { toolName?: string; markdown?: boolean } = {},
): string | null {
  const markdown = options.markdown === true;

  const progress = renderProgress(value);
  if (progress) {
    return progress;
  }

  if (typeof value === "string") {
    return renderJsonString(value, markdown, options.toolName);
  }
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint" ||
    value === null
  ) {
    return String(value);
  }
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const compactSuccess = renderCompactSuccess(record, options.toolName);
  if (compactSuccess) {
    return compactSuccess;
  }
  const readSummary = renderReadSummary(record, options.toolName);
  if (readSummary) {
    return readSummary;
  }

  if (typeof record.text === "string") {
    return renderJsonString(record.text, markdown, options.toolName);
  }

  if (Array.isArray(record.content)) {
    const parts: string[] = [];
    for (const item of record.content) {
      if (!item || typeof item !== "object") {
        try {
          return markdown
            ? `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``
            : JSON.stringify(value, null, 2);
        } catch {
          return renderUnserializableToolOutput(markdown);
        }
      }
      const entry = item as Record<string, unknown>;
      if (entry.type === "text" && typeof entry.text === "string") {
        parts.push(renderJsonString(entry.text, markdown, options.toolName));
        continue;
      }
      if (entry.type === "image") {
        parts.push("[Image]");
        continue;
      }
      try {
        return markdown
          ? `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``
          : JSON.stringify(value, null, 2);
      } catch {
        return renderUnserializableToolOutput(markdown);
      }
    }
    return parts.length > 0 ? parts.join("\n") : null;
  }

  try {
    return markdown
      ? `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``
      : JSON.stringify(value, null, 2);
  } catch {
    return renderUnserializableToolOutput(markdown);
  }
}

/**
 * Format tool output content for display in the sidebar.
 * Applies JSON-aware rendering plus markdown-friendly formatting.
 */
export function formatToolOutputForSidebar(
  text: string,
  details?: unknown,
  toolName?: string,
): string {
  const trimmed = text.trim();
  if (details !== undefined && (!trimmed || trimmed.startsWith("{") || trimmed.startsWith("["))) {
    return renderToolOutputValue(details, { markdown: true, toolName }) ?? text;
  }
  return renderToolOutputValue(text, { markdown: true, toolName }) ?? text;
}

/**
 * Get a truncated preview of tool output text.
 * Truncates to first N lines or first N characters, whichever is shorter.
 */
export function getTruncatedPreview(text: string): string {
  const allLines = text.split("\n");
  const lines = allLines.slice(0, PREVIEW_MAX_LINES);
  const preview = lines.join("\n");
  const widthLimited = truncateToDisplayWidth(preview, PREVIEW_MAX_CHARS);
  if (widthLimited.truncated) {
    const suffixLimited = truncateToDisplayWidth(
      widthLimited.text,
      Math.max(0, PREVIEW_MAX_CHARS - 1),
    );
    return `${suffixLimited.text}…`;
  }
  if (lines.length < allLines.length) {
    if (visibleWidth(preview) >= PREVIEW_MAX_CHARS) {
      const suffixLimited = truncateToDisplayWidth(preview, Math.max(0, PREVIEW_MAX_CHARS - 1));
      return `${suffixLimited.text}…`;
    }
    return `${preview}…`;
  }
  return preview;
}
