/**
 * Helper functions for tool card rendering.
 */

import { PREVIEW_MAX_CHARS, PREVIEW_MAX_LINES } from "./constants.ts";

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

/**
 * Format tool output content for display in the sidebar.
 * Detects JSON and wraps it in a code block with formatting.
 */
export function formatToolOutputForSidebar(text: string): string {
  const trimmed = text.trim();
  // Try to detect and format JSON
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      return "```json\n" + JSON.stringify(parsed, null, 2) + "\n```";
    } catch {
      // Not valid JSON, return as-is
    }
  }
  return text;
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
