function isWordChar(char: string | undefined): boolean {
  if (!char) {
    return false;
  }
  return /[A-Za-z0-9_]/.test(char);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type Range = { start: number; end: number };

function buildCodeRanges(text: string): Range[] {
  const ranges: Range[] = [];
  const regex = /(`+)([\s\S]*?)\1/g;
  for (const match of text.matchAll(regex)) {
    const full = match[0];
    const index = match.index;
    if (typeof index !== "number" || !full) {
      continue;
    }
    ranges.push({ start: index, end: index + full.length });
  }
  return ranges;
}

function isApostrophe(text: string, index: number): boolean {
  return isWordChar(text[index - 1]) && isWordChar(text[index + 1]);
}

function buildQuotedRanges(text: string): Range[] {
  const ranges: Range[] = [];

  const collect = (quote: '"' | "'") => {
    let start = -1;
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      if (char !== quote) {
        continue;
      }
      if (quote === "'" && isApostrophe(text, index)) {
        continue;
      }
      if (index > 0 && text[index - 1] === "\\") {
        continue;
      }
      if (start === -1) {
        start = index;
        continue;
      }
      ranges.push({ start, end: index + 1 });
      start = -1;
    }
  };

  collect('"');
  collect("'");
  return ranges;
}

function buildAngleTagRanges(text: string): Range[] {
  const ranges: Range[] = [];
  const regex = /<\/?[A-Za-z][^>\n]{0,200}>/g;
  for (const match of text.matchAll(regex)) {
    const full = match[0];
    const index = match.index;
    if (typeof index !== "number" || !full) {
      continue;
    }
    ranges.push({ start: index, end: index + full.length });
  }
  return ranges;
}

function buildBracketRanges(text: string, excluded: Range[]): Range[] {
  const ranges: Range[] = [];
  const starts = new Set(["(", "[", "{"]);
  const matching: Record<string, string> = {
    ")": "(",
    "]": "[",
    "}": "{",
  };
  const stack: Array<{ char: string; index: number }> = [];

  const inExcludedRange = (index: number) =>
    excluded.some((range) => index >= range.start && index < range.end);

  for (let index = 0; index < text.length; index += 1) {
    if (inExcludedRange(index)) {
      continue;
    }
    const char = text[index] ?? "";
    if (starts.has(char)) {
      stack.push({ char, index });
      continue;
    }
    const expected = matching[char];
    if (!expected) {
      continue;
    }
    const top = stack[stack.length - 1];
    if (!top || top.char !== expected) {
      continue;
    }
    stack.pop();
    ranges.push({ start: top.index, end: index + 1 });
  }

  return ranges;
}

function buildExcludedRanges(text: string): Range[] {
  const codeRanges = buildCodeRanges(text);
  const quotedRanges = buildQuotedRanges(text);
  const angleRanges = buildAngleTagRanges(text);
  const bracketRanges = buildBracketRanges(text, [...codeRanges, ...quotedRanges, ...angleRanges]);
  return [...codeRanges, ...quotedRanges, ...angleRanges, ...bracketRanges].toSorted(
    (left, right) => left.start - right.start,
  );
}

function isInsideRange(index: number, ranges: Range[]): boolean {
  return ranges.some((range) => index >= range.start && index < range.end);
}

function isWholeWordMatch(text: string, start: number, end: number): boolean {
  return !isWordChar(text[start - 1]) && !isWordChar(text[end]);
}

function isPathLikeJoin(text: string, start: number, end: number): boolean {
  const previous = text[start - 1];
  const next = text[end];
  if (previous === "/" || previous === "\\" || previous === "-" || next === "/" || next === "\\") {
    return true;
  }
  if (next === "-") {
    return true;
  }
  if (next === "." && isWordChar(text[end + 1])) {
    return true;
  }
  if (previous === "." && isWordChar(text[start - 2])) {
    return true;
  }
  return false;
}

function isSlashCommandContext(text: string, start: number): boolean {
  const trimmed = text.trimStart();
  if (trimmed.startsWith("/")) {
    return true;
  }
  return text[start - 1] === "/";
}

function isQuestionContext(text: string, end: number): boolean {
  for (let index = end; index < text.length; index += 1) {
    const char = text[index] ?? "";
    if (/\s/.test(char)) {
      continue;
    }
    return char === "?";
  }
  return false;
}

export function findKeywordTriggerPositions(text: string, keyword: string): number[] {
  const normalizedKeyword = keyword.trim();
  if (!text || !normalizedKeyword) {
    return [];
  }

  const excludedRanges = buildExcludedRanges(text);
  const regex = new RegExp(escapeRegExp(normalizedKeyword), "gi");
  const matches: number[] = [];

  for (const match of text.matchAll(regex)) {
    const index = match.index;
    const value = match[0];
    if (typeof index !== "number" || !value) {
      continue;
    }
    const end = index + value.length;
    if (!isWholeWordMatch(text, index, end)) {
      continue;
    }
    if (isInsideRange(index, excludedRanges)) {
      continue;
    }
    if (isSlashCommandContext(text, index)) {
      continue;
    }
    if (isPathLikeJoin(text, index, end)) {
      continue;
    }
    if (isQuestionContext(text, end)) {
      continue;
    }
    matches.push(index);
  }

  return matches;
}

export function hasKeywordTrigger(text: string, keyword: string): boolean {
  return findKeywordTriggerPositions(text, keyword).length > 0;
}

export function hasAnyKeywordTrigger(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => hasKeywordTrigger(text, keyword));
}
