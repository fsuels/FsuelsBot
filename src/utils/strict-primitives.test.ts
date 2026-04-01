import { describe, expect, it } from "vitest";
import {
  INVALID_STRICT_PRIMITIVE,
  parseBooleanStrict,
  parseIntegerStrict,
  parseNumberStrict,
} from "./strict-primitives.js";

describe("strict primitive parsers", () => {
  it("parses booleans with an explicit token table", () => {
    const accepted: Array<[unknown, boolean]> = [
      [true, true],
      [false, false],
      ["true", true],
      ["TRUE", true],
      ["yes", true],
      ["on", true],
      ["1", true],
      [1, true],
      ["false", false],
      ["FALSE", false],
      ["no", false],
      ["off", false],
      ["0", false],
      [0, false],
    ];
    const rejected = ["", "   ", "maybe", "2", 2, null, undefined];

    for (const [raw, expected] of accepted) {
      expect(parseBooleanStrict(raw)).toBe(expected);
    }
    for (const raw of rejected) {
      expect(parseBooleanStrict(raw)).toBe(INVALID_STRICT_PRIMITIVE);
    }
  });

  it("parses numbers without permissive Number semantics", () => {
    const accepted: Array<[unknown, number]> = [
      [0, 0],
      ["0", 0],
      ["42", 42],
      ["-3.14", -3.14],
      ["+.5", 0.5],
      ["1e3", 1000],
    ];
    const rejected = ["", "   ", "NaN", "Infinity", "42abc", "1_000", null, undefined];

    for (const [raw, expected] of accepted) {
      expect(parseNumberStrict(raw)).toBe(expected);
    }
    for (const raw of rejected) {
      expect(parseNumberStrict(raw)).toBe(INVALID_STRICT_PRIMITIVE);
    }
  });

  it("parses integers without truncating decimals", () => {
    const accepted: Array<[unknown, number]> = [
      [0, 0],
      ["0", 0],
      ["42", 42],
      ["-12", -12],
    ];
    const rejected = ["", "   ", "3.14", 3.14, "1e3", "42abc", null, undefined];

    for (const [raw, expected] of accepted) {
      expect(parseIntegerStrict(raw)).toBe(expected);
    }
    for (const raw of rejected) {
      expect(parseIntegerStrict(raw)).toBe(INVALID_STRICT_PRIMITIVE);
    }
  });

  it("does not turn blank input into zero", () => {
    expect(parseNumberStrict("")).toBe(INVALID_STRICT_PRIMITIVE);
    expect(parseNumberStrict("   ")).toBe(INVALID_STRICT_PRIMITIVE);
    expect(parseIntegerStrict("")).toBe(INVALID_STRICT_PRIMITIVE);
    expect(parseIntegerStrict("   ")).toBe(INVALID_STRICT_PRIMITIVE);
  });
});
