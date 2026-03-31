import { Type } from "@sinclair/typebox";
import { describe, expect, it, vi } from "vitest";
import {
  createStrictEmptyObjectSchema,
  defineOpenClawTool,
  executeToolWithContract,
} from "./tool-contract.js";
import { jsonResult } from "./tools/common.js";

describe("tool contract", () => {
  it("rejects hallucinated args for strict no-input tools", async () => {
    const tool = defineOpenClawTool({
      name: "no_input",
      label: "No input",
      description: "No args",
      parameters: createStrictEmptyObjectSchema(),
      execute: async () => jsonResult({ ok: true }),
    });
    const invoke = vi.fn(async () => jsonResult({ ok: true }));

    await expect(
      executeToolWithContract({
        tool,
        rawInput: { foo: "bar" },
        context: { toolCallId: "call-1", source: "embedded" },
        invoke,
      }),
    ).rejects.toThrow(/Validation failed/);

    expect(invoke).not.toHaveBeenCalled();
  });

  it("stops at validateInput before permission checks", async () => {
    const checkPermissions = vi.fn();
    const invoke = vi.fn(async () => jsonResult({ ok: true }));
    const tool = defineOpenClawTool({
      name: "validate_first",
      label: "Validate first",
      description: "Validate first",
      parameters: Type.Object({
        value: Type.String(),
      }),
      validateInput: async () => ({
        result: false,
        message: "invalid input",
      }),
      checkPermissions,
      execute: async () => jsonResult({ ok: true }),
    });

    await expect(
      executeToolWithContract({
        tool,
        rawInput: { value: "x" },
        context: { toolCallId: "call-2", source: "embedded" },
        invoke,
      }),
    ).rejects.toThrow("invalid input");

    expect(checkPermissions).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("prevents invocation when permission is denied", async () => {
    const invoke = vi.fn(async () => jsonResult({ ok: true }));
    const tool = defineOpenClawTool({
      name: "deny_tool",
      label: "Deny tool",
      description: "Permission gated",
      parameters: Type.Object({
        value: Type.String(),
      }),
      checkPermissions: async () => ({
        behavior: "deny",
        message: "permission denied",
      }),
      execute: async () => jsonResult({ ok: true }),
    });

    await expect(
      executeToolWithContract({
        tool,
        rawInput: { value: "x" },
        context: { toolCallId: "call-3", source: "embedded" },
        invoke,
      }),
    ).rejects.toThrow("permission denied");

    expect(invoke).not.toHaveBeenCalled();
  });

  it("resolves ask permissions before invoking and only executes once", async () => {
    const invoke = vi.fn(async () => jsonResult({ ok: true }));
    const permissionResolver = vi.fn(async () => "allow" as const);
    const tool = defineOpenClawTool({
      name: "ask_tool",
      label: "Ask tool",
      description: "Ask first",
      parameters: Type.Object({
        value: Type.String(),
      }),
      checkPermissions: async () => ({
        behavior: "ask",
        message: "Run test?",
      }),
      execute: async () => jsonResult({ ok: true }),
    });

    await executeToolWithContract({
      tool,
      rawInput: { value: "x" },
      context: {
        toolCallId: "call-4",
        source: "embedded",
        permissionResolver,
      },
      invoke,
    });

    expect(permissionResolver).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("serializes structured results without leaking object-to-string coercion", async () => {
    const tool = defineOpenClawTool({
      name: "object_result",
      label: "Object result",
      description: "Structured output",
      parameters: Type.Object({}),
      maxResultSizeChars: 32,
      execute: async () => jsonResult({ ok: true }),
    });

    const result = await executeToolWithContract({
      tool,
      rawInput: {},
      context: { toolCallId: "call-5", source: "embedded" },
      invoke: async () => ({
        content: [{ type: "text", text: { foo: "bar", nested: { ok: true } } }],
        details: { ok: true },
      }),
    });

    const text = result.content.find((block) => block.type === "text");
    expect(text && "text" in text ? text.text : "").not.toContain("[object Object]");
    expect(text && "text" in text ? text.text : "").toContain("...(truncated)...");
  });
});
