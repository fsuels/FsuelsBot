const ESC = "\u001b";
const BEL = "\u0007";
const ST = `${ESC}\\`;
const TAB_WIDTH = 8;
const graphemeSegmenter =
  typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;
const MARK_REGEX = /^\p{Mark}$/u;
const EXTENDED_PICTOGRAPHIC_REGEX = /\p{Extended_Pictographic}/u;
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

export type TerminalDisplayToken =
  | { kind: "ansi"; value: string; width: 0 }
  | { kind: "grapheme"; value: string; width: number };

export type DisplayGrapheme = {
  value: string;
  width: 0 | 1 | 2;
};

function sliceAnsiRemainder(input: string, index: number) {
  return { value: input.slice(index), nextIndex: input.length };
}

function scanToFinalByte(
  input: string,
  index: number,
  start: number,
): { value: string; nextIndex: number } {
  for (let cursor = start; cursor < input.length; cursor += 1) {
    const code = input.charCodeAt(cursor);
    if (code >= 0x40 && code <= 0x7e) {
      return { value: input.slice(index, cursor + 1), nextIndex: cursor + 1 };
    }
  }
  return sliceAnsiRemainder(input, index);
}

function scanToStringTerminator(
  input: string,
  index: number,
  start: number,
): { value: string; nextIndex: number } {
  for (let cursor = start; cursor < input.length; cursor += 1) {
    if (input[cursor] === BEL) {
      return { value: input.slice(index, cursor + 1), nextIndex: cursor + 1 };
    }
    if (input.slice(cursor, cursor + ST.length) === ST) {
      return { value: input.slice(index, cursor + ST.length), nextIndex: cursor + ST.length };
    }
  }
  return sliceAnsiRemainder(input, index);
}

function scanToStTerminator(
  input: string,
  index: number,
  start: number,
): { value: string; nextIndex: number } {
  for (let cursor = start; cursor < input.length; cursor += 1) {
    if (input.slice(cursor, cursor + ST.length) === ST) {
      return { value: input.slice(index, cursor + ST.length), nextIndex: cursor + ST.length };
    }
  }
  return sliceAnsiRemainder(input, index);
}

function parseAnsiSequence(
  input: string,
  index: number,
): { value: string; nextIndex: number } | null {
  if (input[index] !== ESC) {
    return null;
  }

  const next = input[index + 1];
  if (next === undefined) {
    return { value: ESC, nextIndex: index + 1 };
  }
  if (next === "[") {
    return scanToFinalByte(input, index, index + 2);
  }
  if (next === "]") {
    return scanToStringTerminator(input, index, index + 2);
  }
  if (next === "O") {
    return scanToFinalByte(input, index, index + 2);
  }
  if (next === "P" || next === "_" || next === "^" || next === "X") {
    return scanToStTerminator(input, index, index + 2);
  }
  const nextCode = next.charCodeAt(0);
  if (nextCode >= 0x20 && nextCode <= 0x2f) {
    for (let cursor = index + 2; cursor < input.length; cursor += 1) {
      const code = input.charCodeAt(cursor);
      if (code >= 0x30 && code <= 0x7e) {
        return { value: input.slice(index, cursor + 1), nextIndex: cursor + 1 };
      }
    }
    return sliceAnsiRemainder(input, index);
  }
  return {
    value: input.slice(index, Math.min(index + 2, input.length)),
    nextIndex: Math.min(index + 2, input.length),
  };
}

function expandSingleTab(column: number, tabWidth = TAB_WIDTH): number {
  const normalized = Number.isFinite(tabWidth) && tabWidth > 0 ? Math.floor(tabWidth) : TAB_WIDTH;
  const remainder = column % normalized;
  return remainder === 0 ? normalized : normalized - remainder;
}

function fastAsciiWidth(input: string): number | null {
  let width = 0;
  let column = 0;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    if (code > 0x7f || code === 0x1b) {
      return null;
    }
    if (code === 0x09) {
      const advance = expandSingleTab(column);
      width += advance;
      column += advance;
      continue;
    }
    if (code === 0x0a || code === 0x0d) {
      column = 0;
      continue;
    }
    if (code < 0x20 || code === 0x7f) {
      continue;
    }
    width += 1;
    column += 1;
  }
  return width;
}

export function stripAnsi(input: string): string {
  if (!input.includes(ESC)) {
    return input;
  }
  let output = "";
  for (const token of tokenizeTerminalDisplay(input)) {
    if (token.kind === "grapheme") {
      output += token.value;
    }
  }
  return output;
}

export function splitDisplayGraphemes(value: string): string[] {
  if (!graphemeSegmenter) {
    return Array.from(value);
  }
  try {
    return Array.from(graphemeSegmenter.segment(value), (segment) => segment.segment);
  } catch {
    return Array.from(value);
  }
}

export function segmentDisplayGraphemes(value: string): DisplayGrapheme[] {
  return splitDisplayGraphemes(value).map((grapheme) => ({
    value: grapheme,
    width: graphemeDisplayWidth(grapheme),
  }));
}

function isVariationSelector(codePoint: number): boolean {
  return (
    (codePoint >= 0xfe00 && codePoint <= 0xfe0f) || (codePoint >= 0xe0100 && codePoint <= 0xe01ef)
  );
}

function isControlCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x0000 && codePoint <= 0x001f) || (codePoint >= 0x007f && codePoint <= 0x009f)
  );
}

function isWideCodePoint(codePoint: number): boolean {
  return WIDE_CODE_POINT_RANGES.some(([start, end]) => codePoint >= start && codePoint <= end);
}

function isRegionalIndicator(codePoint: number): boolean {
  return codePoint >= 0x1f1e6 && codePoint <= 0x1f1ff;
}

function codePointWidth(codePoint: number, symbol: string): number {
  if (codePoint === 0x200d || isVariationSelector(codePoint) || MARK_REGEX.test(symbol)) {
    return 0;
  }
  if (isControlCodePoint(codePoint)) {
    return 0;
  }
  return isWideCodePoint(codePoint) ||
    isRegionalIndicator(codePoint) ||
    EXTENDED_PICTOGRAPHIC_REGEX.test(symbol)
    ? 2
    : 1;
}

export function graphemeDisplayWidth(grapheme: string): 0 | 1 | 2 {
  if (grapheme === "\n" || grapheme === "\r" || grapheme === "\t") {
    return 0;
  }
  let width: 0 | 1 | 2 = 0;
  for (const symbol of Array.from(grapheme)) {
    const codePoint = symbol.codePointAt(0);
    if (codePoint === undefined) {
      continue;
    }
    width = Math.max(width, codePointWidth(codePoint, symbol)) as 0 | 1 | 2;
  }
  return width;
}

export function tokenizeTerminalDisplay(input: string): TerminalDisplayToken[] {
  if (!input) {
    return [];
  }

  const tokens: TerminalDisplayToken[] = [];
  for (let cursor = 0; cursor < input.length; ) {
    const ansi = parseAnsiSequence(input, cursor);
    if (ansi) {
      tokens.push({ kind: "ansi", value: ansi.value, width: 0 });
      cursor = ansi.nextIndex;
      continue;
    }

    const nextEscape = input.indexOf(ESC, cursor);
    const plainEnd = nextEscape === -1 ? input.length : nextEscape;
    const plain = input.slice(cursor, plainEnd);
    if (plainEnd === cursor) {
      tokens.push({ kind: "ansi", value: input[cursor] ?? "", width: 0 });
      cursor += 1;
      continue;
    }
    for (const grapheme of segmentDisplayGraphemes(plain)) {
      tokens.push({ kind: "grapheme", value: grapheme.value, width: grapheme.width });
    }
    cursor = plainEnd;
  }
  return tokens;
}

function resolveDisplayGraphemes(
  value: string | readonly DisplayGrapheme[],
): readonly DisplayGrapheme[] {
  return typeof value === "string" ? segmentDisplayGraphemes(value) : value;
}

export function graphemeIndexToCell(
  value: string | readonly DisplayGrapheme[],
  graphemeIndex: number,
): number {
  const graphemes = resolveDisplayGraphemes(value);
  const clampedIndex = Math.max(0, Math.min(graphemes.length, Math.floor(graphemeIndex)));
  let cell = 0;
  for (let index = 0; index < clampedIndex; index += 1) {
    cell += graphemes[index]?.width ?? 0;
  }
  return cell;
}

export function cellToGraphemeIndex(
  value: string | readonly DisplayGrapheme[],
  cell: number,
): number {
  const graphemes = resolveDisplayGraphemes(value);
  const target = Math.max(0, Math.floor(cell));
  let currentCell = 0;
  for (let index = 0; index < graphemes.length; index += 1) {
    const width = graphemes[index]?.width ?? 0;
    if (width === 0) {
      if (target <= currentCell) {
        return index;
      }
      continue;
    }
    const nextCell = currentCell + width;
    if (target < nextCell) {
      return index;
    }
    currentCell = nextCell;
  }
  return graphemes.length;
}

export function expandTabs(input: string, opts: { tabWidth?: number } = {}): string {
  const tabWidth =
    Number.isFinite(opts.tabWidth) && (opts.tabWidth ?? 0) > 0
      ? Math.floor(opts.tabWidth!)
      : TAB_WIDTH;
  let output = "";
  let column = 0;

  for (const token of tokenizeTerminalDisplay(input)) {
    if (token.kind === "ansi") {
      output += token.value;
      continue;
    }
    if (token.value === "\r" || token.value === "\n") {
      output += token.value;
      column = 0;
      continue;
    }
    if (token.value === "\t") {
      const advance = expandSingleTab(column, tabWidth);
      output += " ".repeat(advance);
      column += advance;
      continue;
    }
    output += token.value;
    column += token.width;
  }

  return output;
}

export function visibleWidth(input: string): number {
  const asciiWidth = fastAsciiWidth(input);
  if (asciiWidth !== null) {
    return asciiWidth;
  }

  let width = 0;
  let column = 0;
  for (const token of tokenizeTerminalDisplay(input)) {
    if (token.kind === "ansi") {
      continue;
    }
    if (token.value === "\r" || token.value === "\n") {
      column = 0;
      continue;
    }
    if (token.value === "\t") {
      const advance = expandSingleTab(column);
      width += advance;
      column += advance;
      continue;
    }
    width += token.width;
    column += token.width;
  }
  return width;
}

export const displayWidth = visibleWidth;

function isOsc8Sequence(value: string): boolean {
  return value.startsWith(`${ESC}]8;;`) && (value.endsWith(BEL) || value.endsWith(`${ESC}\\`));
}

function isOsc8CloseSequence(value: string): boolean {
  if (!isOsc8Sequence(value)) {
    return false;
  }
  const terminatorLength = value.endsWith(BEL) ? 1 : 2;
  const body = value.slice(`${ESC}]8;;`.length, value.length - terminatorLength);
  return body.length === 0;
}

function osc8CloseFor(value: string): string {
  return value.endsWith(BEL) ? `${ESC}]8;;${BEL}` : `${ESC}]8;;${ESC}\\`;
}

function isSgrSequence(value: string): boolean {
  return value.startsWith(`${ESC}[`) && value.endsWith("m");
}

function isResetSgrSequence(value: string): boolean {
  if (!isSgrSequence(value)) {
    return false;
  }
  const body = value.slice(2, -1);
  return body === "" || body.split(";").every((part) => part === "0");
}

export function truncateToDisplayWidth(
  input: string,
  maxWidth: number,
  opts: { ellipsis?: string } = {},
): string {
  if (maxWidth <= 0) {
    return "";
  }

  const expandedInput = expandTabs(input);
  const ellipsis = opts.ellipsis ?? "…";
  if (visibleWidth(expandedInput) <= maxWidth) {
    return expandedInput;
  }
  const ellipsisWidth = visibleWidth(ellipsis);
  if (ellipsisWidth >= maxWidth) {
    return "";
  }

  const targetWidth = maxWidth - ellipsisWidth;
  let width = 0;
  let output = "";
  let truncated = false;
  let hasOpenSgr = false;
  let openOsc8: string | null = null;

  for (const token of tokenizeTerminalDisplay(expandedInput)) {
    if (token.kind === "ansi") {
      output += token.value;
      if (isSgrSequence(token.value)) {
        hasOpenSgr = !isResetSgrSequence(token.value);
      } else if (isOsc8Sequence(token.value)) {
        openOsc8 = isOsc8CloseSequence(token.value) ? null : token.value;
      }
      continue;
    }

    if (token.value === "\r" || token.value === "\n") {
      output += token.value;
      continue;
    }

    if (width + token.width > targetWidth) {
      truncated = true;
      break;
    }
    output += token.value;
    width += token.width;
  }

  if (!truncated) {
    return output;
  }

  let suffix = ellipsis;
  if (openOsc8) {
    suffix += osc8CloseFor(openOsc8);
  }
  if (hasOpenSgr) {
    suffix += `${ESC}[0m`;
  }
  return `${output}${suffix}`;
}

export function truncateMiddleToDisplayWidth(
  input: string,
  maxWidth: number,
  opts: { ellipsis?: string } = {},
): string {
  if (maxWidth <= 0) {
    return "";
  }

  const normalizedInput =
    input.includes(ESC) || input.includes("\t") ? stripAnsi(expandTabs(input)) : input;
  const ellipsis = opts.ellipsis ?? "…";
  if (visibleWidth(normalizedInput) <= maxWidth) {
    return normalizedInput;
  }
  const ellipsisWidth = visibleWidth(ellipsis);
  if (ellipsisWidth >= maxWidth) {
    return "";
  }

  const availableWidth = maxWidth - ellipsisWidth;
  const prefixTarget = Math.max(1, Math.ceil(availableWidth / 2));
  const suffixTarget = Math.max(1, Math.floor(availableWidth / 2));
  const graphemes = splitDisplayGraphemes(normalizedInput);

  let prefix = "";
  let prefixWidth = 0;
  for (const grapheme of graphemes) {
    const segmentWidth = graphemeDisplayWidth(grapheme);
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
    const segmentWidth = graphemeDisplayWidth(grapheme);
    if (suffixWidth + segmentWidth > suffixTarget) {
      break;
    }
    suffix = `${grapheme}${suffix}`;
    suffixWidth += segmentWidth;
  }

  while (visibleWidth(`${prefix}${ellipsis}${suffix}`) > maxWidth && prefix.length > 0) {
    const parts = splitDisplayGraphemes(prefix);
    parts.pop();
    prefix = parts.join("");
  }
  while (visibleWidth(`${prefix}${ellipsis}${suffix}`) > maxWidth && suffix.length > 0) {
    const parts = splitDisplayGraphemes(suffix);
    parts.shift();
    suffix = parts.join("");
  }

  return `${prefix}${ellipsis}${suffix}`;
}
