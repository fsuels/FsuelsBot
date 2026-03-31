import type { AgentTool } from "@mariozechner/pi-agent-core";
import { describe, expect, it } from "vitest";
import { toToolDefinitions } from "./pi-tool-definition-adapter.js";
import { createStrictEmptyObjectSchema } from "./tool-contract.js";

describe("pi tool definition adapter", () => {
  it("wraps tool errors into a tool result", async () => {
    const tool = {
      name: "boom",
      label: "Boom",
      description: "throws",
      parameters: {},
      execute: async () => {
        throw new Error("nope");
      },
    } satisfies AgentTool<unknown, unknown>;

    const defs = toToolDefinitions([tool]);
    const result = await defs[0].execute("call1", {}, undefined, undefined);

    expect(result.details).toMatchObject({
      status: "error",
      tool: "boom",
    });
    expect(result.details).toMatchObject({ error: "nope" });
    expect(JSON.stringify(result.details)).not.toContain("\n    at ");
  });

  it("normalizes exec tool aliases in error results", async () => {
    const tool = {
      name: "bash",
      label: "Bash",
      description: "throws",
      parameters: {},
      execute: async () => {
        throw new Error("nope");
      },
    } satisfies AgentTool<unknown, unknown>;

    const defs = toToolDefinitions([tool]);
    const result = await defs[0].execute("call2", {}, undefined, undefined);

    expect(result.details).toMatchObject({
      status: "error",
      tool: "exec",
      error: "nope",
    });
  });

  it("rejects extra args for no-input tools", async () => {
    const tool = {
      name: "empty",
      label: "Empty",
      description: "no args",
      parameters: createStrictEmptyObjectSchema(),
      execute: async () => ({
        content: [{ type: "text", text: "ok" }],
        details: { ok: true },
      }),
    } satisfies AgentTool<unknown, unknown>;

    const defs = toToolDefinitions([tool]);
    const result = await defs[0].execute("call3", { foo: "bar" }, undefined, undefined);

    expect(result.details).toMatchObject({
      status: "error",
      tool: "empty",
    });
    expect(result.details).toMatchObject({
      error: expect.stringContaining("Validation failed"),
    });
  });
});
