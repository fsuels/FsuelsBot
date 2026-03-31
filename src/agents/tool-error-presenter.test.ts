import { describe, expect, it } from "vitest";
import { presentToolError } from "./tool-error-presenter.js";

describe("tool-error-presenter", () => {
  it("extracts tagged tool errors and strips ANSI noise", () => {
    const presented = presentToolError(
      "\u001B[31m<tool_error>Error: bad request\nsecond line</tool_error>\u001B[0m",
    );

    expect(presented).toMatchObject({
      text: "Error: bad request\nsecond line",
      fullText: "Error: bad request\nsecond line",
      classification: "generic",
      truncated: false,
    });
  });

  it("maps structured validation failures to a friendly message", () => {
    const presented = presentToolError({
      code: "invalid_input",
      details: {
        issues: [
          { path: "/path", message: 'unexpected property "bogus"' },
          { path: "/content", message: "must be string" },
        ],
      },
    });

    expect(presented).toMatchObject({
      classification: "validation",
      text: 'Invalid tool input:\n- /path unexpected property "bogus"\n- /content must be string',
    });
  });

  it("preserves cancelled prefixes", () => {
    const presented = presentToolError("Cancelled: user aborted the browser step");

    expect(presented).toMatchObject({
      text: "Cancelled: user aborted the browser step",
      classification: "cancelled",
    });
  });

  it("truncates long multiline errors with a remaining-line affordance", () => {
    const presented = presentToolError(
      Array.from({ length: 12 }, (_, index) => `line ${index + 1}`).join("\n"),
    );

    expect(presented).toMatchObject({
      truncated: true,
      hiddenLineCount: 2,
    });
    expect(presented?.text).toContain("+2 more lines");
    expect(presented?.fullText).toContain("line 12");
  });

  it("falls back to object serialization for non-string errors", () => {
    const presented = presentToolError({
      error: {
        message: "connection timeout",
        code: "ETIMEDOUT",
      },
    });

    expect(presented).toMatchObject({
      text: "connection timeout",
      classification: "generic",
    });
  });
});
