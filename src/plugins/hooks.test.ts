import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { describe, expect, it, vi } from "vitest";
import type { PluginRegistry } from "./registry.js";
import type { PluginHookRegistration } from "./types.js";
import { createHookRunner } from "./hooks.js";

function createRegistry(typedHooks: PluginHookRegistration[] = []): PluginRegistry {
  return {
    plugins: [],
    tools: [],
    hooks: [],
    typedHooks,
    channels: [],
    providers: [],
    gatewayHandlers: {},
    httpHandlers: [],
    httpRoutes: [],
    cliRegistrars: [],
    services: [],
    commands: [],
    diagnostics: [],
  };
}

describe("plugin hook runner matchers", () => {
  it("prefilters before_tool_call hooks by tool matcher", async () => {
    const readHook = vi.fn().mockResolvedValue({ params: { safe: true } });
    const execHook = vi.fn().mockResolvedValue({ block: true, blockReason: "blocked" });
    const registry = createRegistry([
      {
        pluginId: "reader",
        hookName: "before_tool_call",
        handler: readHook,
        matcher: ["read"],
        source: "reader.ts",
      },
      {
        pluginId: "executor",
        hookName: "before_tool_call",
        handler: execHook,
        matcher: ["exec*"],
        source: "executor.ts",
      },
    ]);

    const runner = createHookRunner(registry);
    const result = await runner.runBeforeToolCall(
      { toolName: "read", params: { path: "/tmp/file" } },
      { toolName: "read", agentId: "main" },
    );

    expect(readHook).toHaveBeenCalledTimes(1);
    expect(execHook).not.toHaveBeenCalled();
    expect(result).toEqual({ params: { safe: true } });
  });

  it("prefilters after_tool_call hooks by tool matcher", async () => {
    const readHook = vi.fn().mockResolvedValue(undefined);
    const execHook = vi.fn().mockResolvedValue(undefined);
    const registry = createRegistry([
      {
        pluginId: "reader",
        hookName: "after_tool_call",
        handler: readHook,
        matcher: ["read"],
        source: "reader.ts",
      },
      {
        pluginId: "executor",
        hookName: "after_tool_call",
        handler: execHook,
        matcher: ["exec*"],
        source: "executor.ts",
      },
    ]);

    const runner = createHookRunner(registry);
    await runner.runAfterToolCall(
      { toolName: "read", params: { path: "/tmp/file" }, result: { ok: true } },
      { toolName: "read", agentId: "main" },
    );

    expect(readHook).toHaveBeenCalledTimes(1);
    expect(execHook).not.toHaveBeenCalled();
  });

  it("prefilters tool_result_persist hooks by tool matcher", () => {
    const message = {
      role: "toolResult",
      toolCallId: "call_1",
      isError: false,
      content: [{ type: "text", text: "ok" }],
    } as AgentMessage;
    const readHook = vi.fn().mockReturnValue({
      message: {
        ...message,
        content: [{ type: "text", text: "rewritten" }],
      },
    });
    const execHook = vi.fn().mockReturnValue(undefined);
    const registry = createRegistry([
      {
        pluginId: "reader",
        hookName: "tool_result_persist",
        handler: readHook,
        matcher: ["read"],
        source: "reader.ts",
      },
      {
        pluginId: "executor",
        hookName: "tool_result_persist",
        handler: execHook,
        matcher: ["exec*"],
        source: "executor.ts",
      },
    ]);

    const runner = createHookRunner(registry);
    const result = runner.runToolResultPersist(
      { toolName: "read", toolCallId: "call_1", message },
      { toolName: "read", toolCallId: "call_1", agentId: "main" },
    );

    expect(readHook).toHaveBeenCalledTimes(1);
    expect(execHook).not.toHaveBeenCalled();
    expect(result?.message.content).toEqual([{ type: "text", text: "rewritten" }]);
  });
});
