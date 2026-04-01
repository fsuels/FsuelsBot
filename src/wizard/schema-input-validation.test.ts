import { describe, expect, it } from "vitest";
import {
  getEnumLabels,
  getEnumValues,
  getFormatHint,
  getMultiSelectLabels,
  getMultiSelectValues,
  isEnumSchema,
  isMultiSelectEnumSchema,
  resolveSupportedFieldSchema,
  validateInputAsync,
  validateInputSync,
} from "./schema-input-validation.js";

describe("schema input validation", () => {
  it("maps enum labels to stored values", () => {
    const schema = resolveSupportedFieldSchema({
      oneOf: [
        { const: "fast", title: "Fast Mode" },
        { const: "safe", title: "Safe Mode" },
      ],
    });

    expect(schema).not.toBeNull();
    if (!schema || !isEnumSchema(schema)) {
      throw new Error("expected enum schema");
    }

    expect(getEnumValues(schema)).toEqual(["fast", "safe"]);
    expect(getEnumLabels(schema)).toEqual(["Fast Mode", "Safe Mode"]);
    expect(validateInputSync("Fast Mode", schema)).toEqual({
      isValid: true,
      value: "fast",
    });
    expect(validateInputSync("safe", schema)).toEqual({
      isValid: true,
      value: "safe",
    });
  });

  it("parses multi-select enums and preserves stored values", () => {
    const schema = resolveSupportedFieldSchema({
      type: "array",
      uniqueItems: true,
      items: {
        oneOf: [
          { const: "daily", title: "Daily Summary" },
          { const: "alerts", title: "Alerts" },
        ],
      },
    });

    expect(schema).not.toBeNull();
    if (!schema || !isMultiSelectEnumSchema(schema)) {
      throw new Error("expected multi-select enum schema");
    }

    expect(getMultiSelectValues(schema)).toEqual(["daily", "alerts"]);
    expect(getMultiSelectLabels(schema)).toEqual(["Daily Summary", "Alerts"]);
    expect(validateInputSync(["Daily Summary", "alerts", "alerts"], schema)).toEqual({
      isValid: true,
      value: ["daily", "alerts"],
    });
  });

  it("returns human-readable range errors", () => {
    const textSchema = resolveSupportedFieldSchema({
      type: "string",
      minLength: 2,
      maxLength: 4,
    });
    const integerSchema = resolveSupportedFieldSchema({
      type: "integer",
      minimum: 1,
      maximum: 3,
    });

    expect(textSchema).not.toBeNull();
    expect(integerSchema).not.toBeNull();
    if (!textSchema || !integerSchema) {
      throw new Error("expected supported schemas");
    }

    expect(validateInputSync("a", textSchema)).toEqual({
      isValid: false,
      error: "Must be between 2 and 4 characters.",
    });
    expect(validateInputSync("5", integerSchema)).toEqual({
      isValid: false,
      error: "Must be between 1 and 3.",
    });
  });

  it("validates email, url, date, and date-time formats", async () => {
    const emailSchema = resolveSupportedFieldSchema({ type: "string", format: "email" });
    const urlSchema = resolveSupportedFieldSchema({ type: "string", format: "url" });
    const dateSchema = resolveSupportedFieldSchema({ type: "string", format: "date" });
    const dateTimeSchema = resolveSupportedFieldSchema({ type: "string", format: "date-time" });

    expect(emailSchema).not.toBeNull();
    expect(urlSchema).not.toBeNull();
    expect(dateSchema).not.toBeNull();
    expect(dateTimeSchema).not.toBeNull();
    if (!emailSchema || !urlSchema || !dateSchema || !dateTimeSchema) {
      throw new Error("expected supported schemas");
    }

    expect(validateInputSync("user@example.com", emailSchema)).toEqual({
      isValid: true,
      value: "user@example.com",
    });
    expect(validateInputSync("not-an-email", emailSchema)).toEqual({
      isValid: false,
      error: "Enter a valid email address.",
    });
    expect(validateInputSync("https://example.com/path", urlSchema)).toEqual({
      isValid: true,
      value: "https://example.com/path",
    });
    expect(validateInputSync("example.com", urlSchema)).toEqual({
      isValid: false,
      error: "Enter a valid URL.",
    });
    expect(validateInputSync("2026-03-31", dateSchema)).toEqual({
      isValid: true,
      value: "2026-03-31",
    });
    expect(validateInputSync("2026-02-30", dateSchema)).toEqual({
      isValid: false,
      error: "Use YYYY-MM-DD.",
    });
    expect(await validateInputAsync("2026-03-31T15:00:00Z", dateTimeSchema)).toEqual({
      isValid: true,
      value: "2026-03-31T15:00:00Z",
    });
    expect(validateInputSync("tomorrow at 3pm", dateTimeSchema)).toEqual({
      isValid: false,
      error: "Use ISO 8601 date-time, for example 2026-03-31T15:00:00Z.",
    });
  });

  it("builds one clear hint string from schema metadata", () => {
    const schema = resolveSupportedFieldSchema({
      type: "array",
      minItems: 1,
      maxItems: 2,
      items: {
        oneOf: [
          { const: "daily", title: "Daily Summary" },
          { const: "alerts", title: "Alerts" },
        ],
      },
    });

    expect(schema).not.toBeNull();
    if (!schema) {
      throw new Error("expected supported schema");
    }

    expect(getFormatHint(schema)).toBe(
      "Choose one or more of: Daily Summary, Alerts. Choose 1-2 items.",
    );
  });

  it("returns one clear error string for invalid enum input", () => {
    const schema = resolveSupportedFieldSchema({
      oneOf: [
        { const: "fast", title: "Fast Mode" },
        { const: "safe", title: "Safe Mode" },
      ],
    });

    expect(schema).not.toBeNull();
    if (!schema || !isEnumSchema(schema)) {
      throw new Error("expected enum schema");
    }

    expect(validateInputSync("turbo", schema)).toEqual({
      isValid: false,
      error: "Choose one of: Fast Mode, Safe Mode.",
    });
  });
});
