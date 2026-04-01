import { note as clackNote } from "@clack/prompts";
import { expandTabs, graphemeDisplayWidth, splitDisplayGraphemes, visibleWidth } from "./ansi.js";
import { stylePromptTitle } from "./prompt-style.js";

function splitLongWord(word: string, maxLen: number): string[] {
  if (maxLen <= 0) {
    return [word];
  }
  const parts: string[] = [];
  let current = "";
  let currentWidth = 0;
  for (const grapheme of splitDisplayGraphemes(expandTabs(word))) {
    const nextWidth = graphemeDisplayWidth(grapheme);
    if (current && currentWidth + nextWidth > maxLen) {
      parts.push(current);
      current = grapheme;
      currentWidth = nextWidth;
      continue;
    }
    current += grapheme;
    currentWidth += nextWidth;
  }
  if (current || parts.length === 0) {
    parts.push(current);
  }
  return parts.length > 0 ? parts : [word];
}

function wrapLine(line: string, maxWidth: number): string[] {
  const expandedLine = expandTabs(line);
  if (expandedLine.trim().length === 0) {
    return [expandedLine];
  }
  const match = expandedLine.match(/^(\s*)([-*\u2022]\s+)?(.*)$/);
  const indent = match?.[1] ?? "";
  const bullet = match?.[2] ?? "";
  const content = match?.[3] ?? "";
  const firstPrefix = `${indent}${bullet}`;
  const nextPrefix = `${indent}${bullet ? " ".repeat(bullet.length) : ""}`;
  const firstWidth = Math.max(1, maxWidth - visibleWidth(firstPrefix));
  const nextWidth = Math.max(1, maxWidth - visibleWidth(nextPrefix));

  const words = content.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  let prefix = firstPrefix;
  let available = firstWidth;

  for (const word of words) {
    if (!current) {
      if (visibleWidth(word) > available) {
        const parts = splitLongWord(word, available);
        const first = parts.shift() ?? "";
        lines.push(prefix + first);
        prefix = nextPrefix;
        available = nextWidth;
        for (const part of parts) {
          lines.push(prefix + part);
        }
        continue;
      }
      current = word;
      continue;
    }

    const candidate = `${current} ${word}`;
    if (visibleWidth(candidate) <= available) {
      current = candidate;
      continue;
    }

    lines.push(prefix + current);
    prefix = nextPrefix;
    available = nextWidth;

    if (visibleWidth(word) > available) {
      const parts = splitLongWord(word, available);
      const first = parts.shift() ?? "";
      lines.push(prefix + first);
      for (const part of parts) {
        lines.push(prefix + part);
      }
      current = "";
      continue;
    }
    current = word;
  }

  if (current || words.length === 0) {
    lines.push(prefix + current);
  }

  return lines;
}

export function wrapNoteMessage(
  message: string,
  options: { maxWidth?: number; columns?: number } = {},
): string {
  const columns = options.columns ?? process.stdout.columns ?? 80;
  const maxWidth = options.maxWidth ?? Math.max(40, Math.min(88, columns - 10));
  return message
    .split("\n")
    .flatMap((line) => wrapLine(line, maxWidth))
    .join("\n");
}

export function note(message: string, title?: string) {
  clackNote(wrapNoteMessage(message), stylePromptTitle(title));
}
