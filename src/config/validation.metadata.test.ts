import { describe, expect, it } from "vitest";
import { validateConfigObject } from "./validation.js";

describe("config validation metadata", () => {
  it("returns expected value, invalid input, and remediation hints for typed fields", () => {
    const result = validateConfigObject({
      browser: {
        noSandbox: "yes",
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "browser.noSandbox",
          expected: "boolean",
          invalidValue: "yes",
          suggestion: expect.stringContaining("Chromium"),
          docLink: expect.stringContaining("#trust-boundaries"),
        }),
      ]),
    );
  });

  it("surfaces remediation metadata for invalid enum values", () => {
    const result = validateConfigObject({
      update: {
        channel: "nightly",
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "update.channel",
          expected: expect.stringContaining("stable"),
          invalidValue: "nightly",
          suggestion: expect.stringContaining("expected shape"),
          docLink: expect.stringContaining("#validation-errors"),
        }),
      ]),
    );
  });
});
