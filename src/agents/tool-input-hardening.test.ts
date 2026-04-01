import { describe, expect, it } from "vitest";
import { hardenToolInputForSchema, sanitizeUnicodeString } from "./tool-input-hardening.js";

describe("tool input hardening", () => {
  it("removes hidden Unicode controls and preserves readable text", () => {
    const sanitized = sanitizeUnicodeString("hello\u2066 world\u2069");
    expect(sanitized.value).toBe("hello world");
    expect(sanitized.changed).toBe(true);
    expect(sanitized.strippedCodePointCount).toBe(2);
  });

  it("normalizes compatibility forms before coercion", () => {
    const hardened = hardenToolInputForSchema(
      {
        type: "object",
        properties: {
          count: { type: "number" },
        },
      },
      {
        count: "３０",
      },
    );

    expect(hardened.value).toEqual({ count: 30 });
    expect(hardened.stats.coercedNumberCount).toBe(1);
    expect(hardened.stats.sanitizedStringCount).toBe(1);
  });
});
