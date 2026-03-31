import { beforeEach, describe, expect, it } from "vitest";
import { __testing, createStructuredOutputTool } from "./structured-output-tool.js";

describe("structured output tool", () => {
  beforeEach(() => {
    __testing.resetCaches();
  });

  it("creates a tool for a valid schema", () => {
    const schema = {
      type: "object",
      properties: {
        summary: { type: "string" },
      },
      required: ["summary"],
      additionalProperties: false,
    };

    const result = createStructuredOutputTool({ jsonSchema: schema });
    expect("tool" in result).toBe(true);
    if ("tool" in result) {
      expect(result.tool.name).toBe("structured_output");
      expect(result.tool.description).toContain("exactly once at the end");
    }
  });

  it("returns an error for an invalid schema", () => {
    const schema = {
      type: "object",
      properties: {
        summary: { type: 123 },
      },
    } as unknown as Record<string, unknown>;

    const result = createStructuredOutputTool({ jsonSchema: schema });
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error.message).toContain("Structured output schema is invalid");
      expect(result.error.issues.length).toBeGreaterThan(0);
    }
  });

  it("returns structured_output for a valid payload", async () => {
    const schema = {
      type: "object",
      properties: {
        summary: { type: "string" },
      },
      required: ["summary"],
      additionalProperties: false,
    };

    const result = createStructuredOutputTool({ jsonSchema: schema });
    if (!("tool" in result)) {
      throw new Error("expected tool");
    }

    const toolResult = await result.tool.execute("call_1", { summary: "done" });
    expect(toolResult.content[0]?.type).toBe("text");
    expect((toolResult.content[0] as { text?: string }).text).toContain("captured");
    expect(toolResult.details).toEqual({
      status: "ok",
      message: "Structured output captured.",
      structured_output: { summary: "done" },
    });
  });

  it("returns safe aggregated validation diagnostics for an invalid payload", async () => {
    const schema = {
      type: "object",
      properties: {
        summary: { type: "string" },
      },
      required: ["summary"],
      additionalProperties: false,
    };

    const result = createStructuredOutputTool({ jsonSchema: schema });
    if (!("tool" in result)) {
      throw new Error("expected tool");
    }

    const toolResult = await result.tool.execute("call_1", { summary: 42, extra: true });
    expect((toolResult.content[0] as { text?: string }).text).toContain(
      "Structured output validation failed:",
    );
    expect((toolResult.content[0] as { text?: string }).text).toContain("/summary:");
    expect(toolResult.details).toMatchObject({
      status: "error",
      error_code: "structured_output_validation_failed",
    });
  });

  it("does not recompile for the same schema object", () => {
    const schema = {
      type: "object",
      properties: {
        summary: { type: "string" },
      },
      additionalProperties: false,
    };

    createStructuredOutputTool({ jsonSchema: schema });
    createStructuredOutputTool({ jsonSchema: schema });

    expect(__testing.getCompileCount()).toBe(1);
  });

  it("reuses the canonical cache for equivalent schema objects", () => {
    const schema1 = {
      type: "object",
      properties: {
        summary: { type: "string" },
      },
      required: ["summary"],
      additionalProperties: false,
    };
    const schema2 = {
      additionalProperties: false,
      required: ["summary"],
      properties: {
        summary: { type: "string" },
      },
      type: "object",
    };

    createStructuredOutputTool({ jsonSchema: schema1 });
    createStructuredOutputTool({ jsonSchema: schema2 });

    expect(__testing.getCompileCount()).toBe(1);
  });
});
