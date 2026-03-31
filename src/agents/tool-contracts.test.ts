import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { describe, expect, it, vi } from "vitest";
import "./test-helpers/fast-core-tools.js";
import { defineOpenClawTool } from "./tool-contract.js";
import { applyToolContracts, createStructuredToolFailureResult } from "./tool-contracts.js";
import { createAgentsListTool } from "./tools/agents-list-tool.js";

describe("tool contracts", () => {
  it("rejects unknown input fields by default for object schemas", async () => {
    const execute = vi.fn(async (_toolCallId: string, params: unknown) => ({
      content: [{ type: "text" as const, text: "ok" }],
      details: params,
    }));

    const tool = applyToolContracts({
      name: "sample",
      label: "Sample",
      description: "sample tool",
      parameters: Type.Object({
        query: Type.String(),
      }),
      execute,
    } satisfies AgentTool);

    const result = await tool.execute("call-1", {
      query: "hello",
      extra: true,
    });

    expect(execute).not.toHaveBeenCalled();
    expect(result.details).toMatchObject({
      ok: false,
      success: false,
      code: "invalid_input",
      tool: "sample",
    });
    expect(result.details).toMatchObject({
      issues: [{ path: "/extra" }],
    });
  });

  it("keeps explicit open object schemas open", async () => {
    const execute = vi.fn(async (_toolCallId: string, params: unknown) => ({
      content: [{ type: "text" as const, text: "ok" }],
      details: params,
    }));

    const tool = applyToolContracts({
      name: "open",
      label: "Open",
      description: "open tool",
      parameters: Type.Object({}, { additionalProperties: true }),
      execute,
    } satisfies AgentTool);

    const result = await tool.execute("call-2", { extra: true });

    expect(execute).toHaveBeenCalledOnce();
    expect(result.details).toEqual({ extra: true });
  });

  it("passes normalized params from OpenClaw-style validateInput", async () => {
    const execute = vi.fn(async (_toolCallId: string, params: unknown) => ({
      content: [{ type: "text" as const, text: "ok" }],
      details: params,
    }));

    const tool = applyToolContracts(
      defineOpenClawTool({
        name: "normalize",
        label: "Normalize",
        description: "normalize tool",
        parameters: Type.Object({
          value: Type.String(),
        }),
        validateInput: async (input, _context) => ({
          result: true,
          params: {
            value: input.value.trim().toUpperCase(),
          },
        }),
        execute,
      }),
    );

    const result = await tool.execute("call-normalize", { value: "  hello " });

    expect(execute).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith(
      "call-normalize",
      { value: "HELLO" },
      undefined,
      undefined,
    );
    expect(result.details).toEqual({ value: "HELLO" });
  });

  it("returns structured invalid_input results for real runtime tools", async () => {
    const tool = applyToolContracts(createAgentsListTool());

    const result = await tool.execute("call-3", { bogus: true });
    expect(result.details).toMatchObject({
      ok: false,
      success: false,
      code: "invalid_input",
      tool: "agents_list",
    });
  });

  it("builds structured benign failures for not found states", () => {
    const result = createStructuredToolFailureResult({
      toolName: "session_status",
      code: "not_found",
      message: "Unknown session",
      details: { sessionKey: "missing-key" },
    });
    expect(result.details).toMatchObject({
      ok: false,
      success: false,
      found: false,
      code: "not_found",
      sessionKey: "missing-key",
    });
  });

  it("supports OpenClaw-style validateInput hooks inside applyToolContracts", async () => {
    const execute = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "ok" }],
      details: { ok: true },
    }));

    const tool = applyToolContracts(
      defineOpenClawTool({
        name: "openclaw_validate",
        label: "OpenClaw Validate",
        description: "test",
        parameters: Type.Object({
          value: Type.String(),
        }),
        validateInput: async () => ({
          result: false,
          errorCode: 400,
          message: "blocked by validator",
        }),
        execute,
      }),
    );

    const result = await tool.execute("call-4", { value: "x" });

    expect(execute).not.toHaveBeenCalled();
    expect(result.details).toMatchObject({
      ok: false,
      success: false,
      code: "invalid_input",
      tool: "openclaw_validate",
      message: "blocked by validator",
    });
  });
});
