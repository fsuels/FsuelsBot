import { describe, expect, it } from "vitest";
import {
  cellToGraphemeIndex,
  graphemeIndexToCell,
  segmentDisplayGraphemes,
  tokenizeTerminalDisplay,
  expandTabs,
  stripAnsi,
  truncateMiddleToDisplayWidth,
  truncateToDisplayWidth,
  visibleWidth,
} from "./ansi.js";

describe("terminal ansi helpers", () => {
  it("strips ansi escape sequences before measuring width", () => {
    expect(stripAnsi("\u001b[31mhello\u001b[0m")).toBe("hello");
    expect(visibleWidth("\u001b[31mhello\u001b[0m")).toBe(5);
    expect(stripAnsi("\u001b]8;;https://openclaw.ai\u0007docs\u001b]8;;\u0007")).toBe("docs");
  });

  it("measures combining characters and wide glyphs using display width", () => {
    expect(visibleWidth("Cafe\u0301")).toBe(4);
    expect(visibleWidth("你好")).toBe(4);
    expect(visibleWidth("🙂")).toBe(2);
    expect(visibleWidth("🇺🇸")).toBe(2);
    expect(visibleWidth("\u0646\u0650")).toBe(1);
    expect(visibleWidth("\u0915\u093f")).toBe(1);
  });

  it("segments graphemes with stable display widths for emoji and combining marks", () => {
    expect(segmentDisplayGraphemes("e\u0301")).toEqual([{ value: "e\u0301", width: 1 }]);
    expect(segmentDisplayGraphemes("👨‍👩‍👧‍👦")).toEqual([{ value: "👨‍👩‍👧‍👦", width: 2 }]);
    expect(segmentDisplayGraphemes("🇺🇸")).toEqual([{ value: "🇺🇸", width: 2 }]);
  });

  it("expands tabs against terminal columns instead of raw character count", () => {
    expect(expandTabs("a\tb")).toBe(`a${" ".repeat(7)}b`);
    expect(visibleWidth("a\tb")).toBe(9);
  });

  it("truncates to display width without splitting wide graphemes", () => {
    expect(truncateToDisplayWidth("alpha🙂beta", 8)).toBe("alpha🙂…");
    expect(visibleWidth(truncateToDisplayWidth("alpha🙂beta", 8))).toBeLessThanOrEqual(8);
    expect(truncateToDisplayWidth("hi👨‍👩‍👧‍👦there", 5)).toBe("hi👨‍👩‍👧‍👦…");
  });

  it("preserves ANSI styling boundaries when truncating colored text", () => {
    const value = truncateToDisplayWidth("\u001b[31mhello world\u001b[0m", 7);
    expect(value).toContain("\u001b[31m");
    expect(value.endsWith("\u001b[0m")).toBe(true);
    expect(visibleWidth(value)).toBeLessThanOrEqual(7);
  });

  it("middle-truncates while preserving the start and end of identifiers", () => {
    const value = truncateMiddleToDisplayWidth("agent:default:very-long-session", 14);
    expect(value).toContain("…");
    expect(value.startsWith("agent")).toBe(true);
    expect(value.endsWith("ession")).toBe(true);
    expect(visibleWidth(value)).toBeLessThanOrEqual(14);
  });

  it("maps grapheme indexes and cells without splitting wide clusters", () => {
    const value = "A🙂中B";
    expect(graphemeIndexToCell(value, 0)).toBe(0);
    expect(graphemeIndexToCell(value, 2)).toBe(3);
    expect(cellToGraphemeIndex(value, 0)).toBe(0);
    expect(cellToGraphemeIndex(value, 1)).toBe(1);
    expect(cellToGraphemeIndex(value, 2)).toBe(1);
    expect(cellToGraphemeIndex(value, 3)).toBe(2);
    expect(cellToGraphemeIndex(value, 5)).toBe(3);
  });

  it("consumes incomplete and less-common ANSI sequences without hanging", () => {
    expect(tokenizeTerminalDisplay("\u001b]8;;https://docs.openclaw.ai")).toEqual([
      {
        kind: "ansi",
        value: "\u001b]8;;https://docs.openclaw.ai",
        width: 0,
      },
    ]);
    expect(tokenizeTerminalDisplay("\u001bPtmux;\u001b\u001b]52;c;aGVsbG8=\u0007\u001b\\")).toEqual(
      [
        {
          kind: "ansi",
          value: "\u001bPtmux;\u001b\u001b]52;c;aGVsbG8=\u0007\u001b\\",
          width: 0,
        },
      ],
    );
    expect(stripAnsi("\u001b]8;;https://docs.openclaw.aihello")).toBe("");
  });
});
