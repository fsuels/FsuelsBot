import { describe, expect, it } from "vitest";
import {
  stripAnsi,
  truncateMiddleToDisplayWidth,
  truncateToDisplayWidth,
  visibleWidth,
} from "./ansi.js";

describe("terminal ansi helpers", () => {
  it("strips ansi escape sequences before measuring width", () => {
    expect(stripAnsi("\u001b[31mhello\u001b[0m")).toBe("hello");
    expect(visibleWidth("\u001b[31mhello\u001b[0m")).toBe(5);
  });

  it("measures combining characters and wide glyphs using display width", () => {
    expect(visibleWidth("Cafe\u0301")).toBe(4);
    expect(visibleWidth("你好")).toBe(4);
    expect(visibleWidth("🙂")).toBe(2);
  });

  it("truncates to display width without splitting wide graphemes", () => {
    expect(truncateToDisplayWidth("alpha🙂beta", 8)).toBe("alpha🙂…");
    expect(visibleWidth(truncateToDisplayWidth("alpha🙂beta", 8))).toBeLessThanOrEqual(8);
  });

  it("middle-truncates while preserving the start and end of identifiers", () => {
    const value = truncateMiddleToDisplayWidth("agent:default:very-long-session", 14);
    expect(value).toContain("…");
    expect(value.startsWith("agent")).toBe(true);
    expect(value.endsWith("ession")).toBe(true);
    expect(visibleWidth(value)).toBeLessThanOrEqual(14);
  });
});
