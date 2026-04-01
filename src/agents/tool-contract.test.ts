import { Type } from "@sinclair/typebox";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createStrictEmptyObjectSchema,
  defineOpenClawTool,
  executeToolWithContract,
} from "./tool-contract.js";
import { resolveToolResultArtifactsDir } from "./tool-result-artifacts.js";
import { jsonResult } from "./tools/common.js";

describe("tool contract", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

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

  it("formats nested validation paths for thrown schema errors", async () => {
    const tool = defineOpenClawTool({
      name: "nested_input",
      label: "Nested input",
      description: "Nested args",
      parameters: Type.Object({
        todos: Type.Array(
          Type.Object({
            activeForm: Type.String(),
          }),
        ),
      }),
      execute: async () => jsonResult({ ok: true }),
    });

    await expect(
      executeToolWithContract({
        tool,
        rawInput: { todos: [{ activeForm: { invalid: true } }] },
        context: { toolCallId: "call-nested-invalid", source: "embedded" },
        invoke: vi.fn(async () => jsonResult({ ok: true })),
      }),
    ).rejects.toThrow(/todos\[0\]\.activeForm: type mismatch \(expected string\)/);
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

  it("uses normalized params returned by validateInput", async () => {
    const invoke = vi.fn(async (input) => jsonResult({ ok: true, input }));
    const tool = defineOpenClawTool({
      name: "normalize_tool",
      label: "Normalize",
      description: "Normalize input before invocation",
      parameters: Type.Object({
        value: Type.String(),
      }),
      validateInput: async (input) => ({
        result: true,
        params: { value: input.value.trim().toUpperCase() },
      }),
      execute: async () => jsonResult({ ok: true }),
    });

    await executeToolWithContract({
      tool,
      rawInput: { value: "  hello  " },
      context: { toolCallId: "call-normalize", source: "embedded" },
      invoke,
    });

    expect(invoke).toHaveBeenCalledWith({ value: "HELLO" });
  });

  it("sanitizes hidden Unicode and coerces semantic scalar strings before invoke", async () => {
    const invoke = vi.fn(async (input) => jsonResult({ ok: true, input }));
    const tool = defineOpenClawTool({
      name: "harden_input",
      label: "Harden Input",
      description: "Sanitize tool input before validation",
      parameters: Type.Object({
        query: Type.String(),
        recursive: Type.Boolean(),
        limit: Type.Number(),
      }),
      execute: async () => jsonResult({ ok: true }),
    });

    await executeToolWithContract({
      tool,
      rawInput: {
        "qu\u2066ery": "Ｆｏｏ\u2069",
        recursive: "false",
        limit: "30",
      },
      context: { toolCallId: "call-harden", source: "embedded" },
      invoke,
    });

    expect(invoke).toHaveBeenCalledWith({
      query: "Foo",
      recursive: false,
      limit: 30,
    });
  });

  it("keeps invalid quoted scalar values as validation errors", async () => {
    const invoke = vi.fn(async (input) => jsonResult({ ok: true, input }));
    const tool = defineOpenClawTool({
      name: "strict_scalars",
      label: "Strict Scalars",
      description: "Reject invalid quoted scalars",
      parameters: Type.Object({
        recursive: Type.Boolean(),
        limit: Type.Number(),
      }),
      execute: async () => jsonResult({ ok: true }),
    });

    await expect(
      executeToolWithContract({
        tool,
        rawInput: {
          recursive: "definitely",
          limit: "thirty",
        },
        context: { toolCallId: "call-invalid-scalars", source: "embedded" },
        invoke,
      }),
    ).rejects.toThrow(/Validation failed/);

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

  it("validates declared output schemas at runtime", async () => {
    const tool = defineOpenClawTool({
      name: "validated_output",
      label: "Validated Output",
      description: "Checks output details",
      parameters: Type.Object({}),
      outputSchema: Type.Object({
        ok: Type.Boolean(),
      }),
      execute: async () => jsonResult({ ok: true }),
    });

    await expect(
      executeToolWithContract({
        tool,
        rawInput: {},
        context: { toolCallId: "call-output", source: "embedded" },
        invoke: async () => ({
          content: [{ type: "text", text: "bad" }],
          details: { ok: "nope" },
        }),
      }),
    ).rejects.toThrow(/validated_output output/i);
  });

  it("externalizes oversized text blocks before they reach model context", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-tool-result-"));
    vi.stubEnv("OPENCLAW_STATE_DIR", stateDir);
    const tool = defineOpenClawTool({
      name: "large_result",
      label: "Large Result",
      description: "Large tool output",
      parameters: Type.Object({}),
      execute: async () => jsonResult({ ok: true }),
    });
    const hugeText = "A".repeat(25_000);

    const result = await executeToolWithContract({
      tool,
      rawInput: {},
      context: { toolCallId: "call-large", source: "embedded" },
      invoke: async () => ({
        content: [{ type: "text", text: hugeText }],
        details: { ok: true },
      }),
    });

    const text = result.content.find((block) => block.type === "text");
    const toolText = text && "text" in text ? text.text : "";
    expect(toolText).toContain("Tool output was externalized to protect model context.");
    expect(toolText).toContain(resolveToolResultArtifactsDir(process.env));
    expect(toolText.length).toBeLessThan(10_000);
    const artifactDirEntries = await fs.readdir(resolveToolResultArtifactsDir(process.env));
    expect(artifactDirEntries.length).toBeGreaterThan(0);
  });

  it("reuses the same artifact path for identical oversized text output", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-tool-result-stable-"));
    vi.stubEnv("OPENCLAW_STATE_DIR", stateDir);
    const tool = defineOpenClawTool({
      name: "stable_large_result",
      label: "Stable Large Result",
      description: "Stable artifact path",
      parameters: Type.Object({}),
      execute: async () => jsonResult({ ok: true }),
    });
    const hugeText = ["heading", "alpha", "beta", "gamma", "delta".repeat(5_000)].join("\n");

    const first = await executeToolWithContract({
      tool,
      rawInput: {},
      context: { toolCallId: "call-large-1", source: "embedded" },
      invoke: async () => ({
        content: [{ type: "text", text: hugeText }],
        details: { ok: true },
      }),
    });
    const second = await executeToolWithContract({
      tool,
      rawInput: {},
      context: { toolCallId: "call-large-2", source: "embedded" },
      invoke: async () => ({
        content: [{ type: "text", text: hugeText }],
        details: { ok: true },
      }),
    });

    const firstText = first.content.find((block) => block.type === "text");
    const secondText = second.content.find((block) => block.type === "text");
    const firstToolText = firstText && "text" in firstText ? firstText.text : "";
    const secondToolText = secondText && "text" in secondText ? secondText.text : "";

    expect(firstToolText).toBe(secondToolText);
    const artifactDirEntries = await fs.readdir(resolveToolResultArtifactsDir(process.env));
    expect(artifactDirEntries).toHaveLength(1);
  });

  it("externalizes base64 data URLs as binary artifacts", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-tool-binary-"));
    vi.stubEnv("OPENCLAW_STATE_DIR", stateDir);
    const tool = defineOpenClawTool({
      name: "binary_result",
      label: "Binary Result",
      description: "Binary tool output",
      parameters: Type.Object({}),
      execute: async () => jsonResult({ ok: true }),
    });

    const result = await executeToolWithContract({
      tool,
      rawInput: {},
      context: { toolCallId: "call-binary", source: "embedded" },
      invoke: async () => ({
        content: [{ type: "text", text: "data:image/png;base64,aGVsbG8=" }],
        details: { ok: true },
      }),
    });

    const text = result.content.find((block) => block.type === "text");
    const toolText = text && "text" in text ? text.text : "";
    expect(toolText).toContain("Binary tool output was saved outside model context.");
    expect(toolText).toContain(".png");
    expect(toolText).not.toContain("data:image/png;base64");
    const artifactDirEntries = await fs.readdir(resolveToolResultArtifactsDir(process.env));
    expect(artifactDirEntries.some((entry) => entry.endsWith(".png"))).toBe(true);
  });
});
