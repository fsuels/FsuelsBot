const ANSI_SGR_PATTERN = "\\x1b\\[[0-9;]*m";
// OSC-8 hyperlinks: ESC ] 8 ; ; url ST ... ESC ] 8 ; ; ST
const OSC8_PATTERN = "\\x1b\\]8;;.*?\\x1b\\\\|\\x1b\\]8;;\\x1b\\\\";

const ANSI_REGEX = new RegExp(ANSI_SGR_PATTERN, "g");
const OSC8_REGEX = new RegExp(OSC8_PATTERN, "g");
const graphemeSegmenter =
  typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
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

export function stripAnsi(input: string): string {
  return input.replace(OSC8_REGEX, "").replace(ANSI_REGEX, "");
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

export function visibleWidth(input: string): number {
  let width = 0;
  for (const grapheme of splitGraphemes(stripAnsi(input))) {
    if (grapheme === "\n") {
      continue;
    }
    width += graphemeWidth(grapheme);
  }
  return width;
}

export function truncateToDisplayWidth(
  input: string,
  maxWidth: number,
  opts: { ellipsis?: string } = {},
): string {
  if (maxWidth <= 0) {
    return "";
  }
  const ellipsis = opts.ellipsis ?? "…";
  if (visibleWidth(input) <= maxWidth) {
    return input;
  }
  const ellipsisWidth = visibleWidth(ellipsis);
  if (ellipsisWidth >= maxWidth) {
    return "";
  }

  const targetWidth = maxWidth - ellipsisWidth;
  let width = 0;
  let output = "";
  for (const grapheme of splitGraphemes(input)) {
    const segmentWidth = grapheme === "\n" ? 0 : graphemeWidth(grapheme);
    if (width + segmentWidth > targetWidth) {
      break;
    }
    output += grapheme;
    width += segmentWidth;
  }
  return `${output}${ellipsis}`;
}

export function truncateMiddleToDisplayWidth(
  input: string,
  maxWidth: number,
  opts: { ellipsis?: string } = {},
): string {
  if (maxWidth <= 0) {
    return "";
  }
  const ellipsis = opts.ellipsis ?? "…";
  if (visibleWidth(input) <= maxWidth) {
    return input;
  }
  const ellipsisWidth = visibleWidth(ellipsis);
  if (ellipsisWidth >= maxWidth) {
    return "";
  }

  const availableWidth = maxWidth - ellipsisWidth;
  const prefixTarget = Math.max(1, Math.ceil(availableWidth / 2));
  const suffixTarget = Math.max(1, Math.floor(availableWidth / 2));
  const graphemes = splitGraphemes(input);

  let prefix = "";
  let prefixWidth = 0;
  for (const grapheme of graphemes) {
    const segmentWidth = grapheme === "\n" ? 0 : graphemeWidth(grapheme);
    if (prefixWidth + segmentWidth > prefixTarget) {
      break;
    }
    prefix += grapheme;
    prefixWidth += segmentWidth;
  }

  let suffix = "";
  let suffixWidth = 0;
  for (let index = graphemes.length - 1; index >= 0; index -= 1) {
    const grapheme = graphemes[index] ?? "";
    const segmentWidth = grapheme === "\n" ? 0 : graphemeWidth(grapheme);
    if (suffixWidth + segmentWidth > suffixTarget) {
      break;
    }
    suffix = `${grapheme}${suffix}`;
    suffixWidth += segmentWidth;
  }

  while (visibleWidth(`${prefix}${ellipsis}${suffix}`) > maxWidth && prefix.length > 0) {
    const parts = splitGraphemes(prefix);
    parts.pop();
    prefix = parts.join("");
  }
  while (visibleWidth(`${prefix}${ellipsis}${suffix}`) > maxWidth && suffix.length > 0) {
    const parts = splitGraphemes(suffix);
    parts.shift();
    suffix = parts.join("");
  }

  return `${prefix}${ellipsis}${suffix}`;
}
