import { describe, expect, it } from "vitest";
import { parseSessionTag } from "./session-tag.js";

describe("parseSessionTag", () => {
  it("normalizes unicode compatibility forms", () => {
    const parsed = parseSessionTag("Ｆｏｏ");
    expect(parsed).toEqual({
      ok: true,
      tag: "Foo",
      strippedHidden: false,
    });
  });

  it("strips hidden and control characters", () => {
    const parsed = parseSessionTag("alpha\u200B\u0007 beta");
    expect(parsed).toEqual({
      ok: true,
      tag: "alpha beta",
      strippedHidden: true,
    });
  });

  it("rejects empty tags after sanitization", () => {
    expect(parseSessionTag("\u200B \n\t")).toEqual({
      ok: false,
      error: "invalid tag: empty",
    });
  });
});
