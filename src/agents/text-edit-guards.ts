import { FileToolError } from "./file-edit-safety.js";

const TEMPLATE_PLACEHOLDER_RE = /\{\{[\s\S]*?\}\}/g;
const MEDIA_PLACEHOLDER_RE = /<media:[^>\n]+>/g;
const PROTECTED_SPAN_PREVIEW_LIMIT = 120;

const graphemeSegmenter =
  typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

export type ProtectedSpanKind = "template_placeholder" | "media_placeholder";

export type ProtectedSpan = Readonly<{
  kind: ProtectedSpanKind;
  start: number;
  end: number;
  text: string;
}>;

function collectProtectedSpansForPattern(
  text: string,
  re: RegExp,
  kind: ProtectedSpanKind,
): ProtectedSpan[] {
  const spans: ProtectedSpan[] = [];
  re.lastIndex = 0;
  for (const match of text.matchAll(re)) {
    const matchedText = match[0];
    const start = match.index ?? -1;
    if (!matchedText || start < 0) {
      continue;
    }
    spans.push({
      kind,
      start,
      end: start + matchedText.length,
      text: matchedText,
    });
  }
  return spans;
}

export function findProtectedSpans(text: string): ProtectedSpan[] {
  return [
    ...collectProtectedSpansForPattern(text, TEMPLATE_PLACEHOLDER_RE, "template_placeholder"),
    ...collectProtectedSpansForPattern(text, MEDIA_PLACEHOLDER_RE, "media_placeholder"),
  ].toSorted((left, right) => left.start - right.start || left.end - right.end);
}

function collectGraphemeBoundaries(text: string): Set<number> {
  const boundaries = new Set<number>([0, text.length]);
  if (graphemeSegmenter) {
    for (const part of graphemeSegmenter.segment(text)) {
      boundaries.add(part.index);
      boundaries.add(part.index + part.segment.length);
    }
    return boundaries;
  }

  let offset = 0;
  for (const symbol of Array.from(text)) {
    boundaries.add(offset);
    offset += symbol.length;
    boundaries.add(offset);
  }
  return boundaries;
}

function describeProtectedSpanKind(kind: ProtectedSpanKind): string {
  switch (kind) {
    case "template_placeholder":
      return "template placeholder";
    case "media_placeholder":
      return "media placeholder";
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

function previewProtectedSpan(text: string): string {
  if (text.length <= PROTECTED_SPAN_PREVIEW_LIMIT) {
    return text;
  }
  return `${text.slice(0, PROTECTED_SPAN_PREVIEW_LIMIT - 1)}...`;
}

function findPartiallyOverlappedProtectedSpan(
  spans: readonly ProtectedSpan[],
  start: number,
  end: number,
): ProtectedSpan | null {
  for (const span of spans) {
    if (start === end) {
      if (span.start < start && start < span.end) {
        return span;
      }
      continue;
    }

    const overlaps = start < span.end && end > span.start;
    const fullyCovers = start <= span.start && end >= span.end;
    if (overlaps && !fullyCovers) {
      return span;
    }
  }
  return null;
}

export function assertTextEditRangeIsSafe(params: {
  toolName: string;
  filePath: string;
  text: string;
  start: number;
  end: number;
}): void {
  const { toolName, filePath, text, start, end } = params;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) {
    throw new FileToolError({
      errorCode: "invalid_edit_request",
      contractCode: "invalid_input",
      message: `${toolName} received an invalid text edit range for ${filePath}.`,
      details: { path: filePath, start, end },
    });
  }

  if (end > text.length) {
    throw new FileToolError({
      errorCode: "invalid_edit_request",
      contractCode: "invalid_input",
      message: `${toolName} tried to edit past the end of ${filePath}.`,
      details: { path: filePath, start, end, text_length: text.length },
    });
  }

  const graphemeBoundaries = collectGraphemeBoundaries(text);
  if (!graphemeBoundaries.has(start) || !graphemeBoundaries.has(end)) {
    throw new FileToolError({
      errorCode: "invalid_edit_request",
      contractCode: "invalid_input",
      message:
        `${toolName} would split a user-visible character in ${filePath}. ` +
        "Expand the edit to whole grapheme clusters and retry.",
      details: {
        path: filePath,
        start,
        end,
        reason: "split_grapheme_cluster",
      },
    });
  }

  const protectedSpan = findPartiallyOverlappedProtectedSpan(findProtectedSpans(text), start, end);
  if (!protectedSpan) {
    return;
  }

  throw new FileToolError({
    errorCode: "invalid_edit_request",
    contractCode: "invalid_input",
    message:
      `${toolName} would partially edit a protected ${describeProtectedSpanKind(protectedSpan.kind)} ` +
      `in ${filePath}. Expand the edit to the full token or edit around it instead.`,
    details: {
      path: filePath,
      start,
      end,
      reason: "partial_protected_span",
      protected_span: {
        kind: protectedSpan.kind,
        start: protectedSpan.start,
        end: protectedSpan.end,
        preview: previewProtectedSpan(protectedSpan.text),
      },
    },
  });
}
