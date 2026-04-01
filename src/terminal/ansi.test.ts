import { describe, expect, it } from "vitest";
import {
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
    expect(visibleWidth("\u0646\u0650")).toBe(1);
    expect(visibleWidth("\u0915\u093f")).toBe(1);
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
});
