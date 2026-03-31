import { beforeEach, describe, expect, it, vi } from "vitest";

const callGatewayMock = vi.fn();
vi.mock("../gateway/call.js", () => ({
  callGateway: (opts: unknown) => callGatewayMock(opts),
}));

import { applyToolContracts } from "./tool-contracts.js";
import { createCanvasTool } from "./tools/canvas-tool.js";
import { createCronTool } from "./tools/cron-tool.js";
import { createGatewayTool } from "./tools/gateway-tool.js";
import { createNodesTool } from "./tools/nodes-tool.js";
import { createTaskTrackerTool } from "./tools/task-tracker-tool.js";

function getTool(name: string, opts?: { agentSessionKey?: string }) {
  switch (name) {
    case "gateway":
      return applyToolContracts(createGatewayTool({ agentSessionKey: opts?.agentSessionKey }));
    case "canvas":
      return applyToolContracts(createCanvasTool());
    case "nodes":
      return applyToolContracts(createNodesTool({ agentSessionKey: opts?.agentSessionKey }));
    case "cron":
      return applyToolContracts(createCronTool({ agentSessionKey: opts?.agentSessionKey }));
    case "task_tracker":
      return applyToolContracts(
        createTaskTrackerTool({ agentSessionKey: opts?.agentSessionKey ?? "agent:main:main" }),
      );
    default:
      throw new Error(`missing ${name} tool`);
  }
}

describe("flattened action tool validation", () => {
  beforeEach(() => {
    callGatewayMock.mockReset();
    callGatewayMock.mockResolvedValue({ ok: true });
  });

  it.each([
    ["gateway", { action: "config.apply" }, "raw required for action=config.apply"],
    ["nodes", { action: "notify", node: "node-1" }, "title or body required for action=notify"],
    ["cron", { action: "update", jobId: "job-1" }, "patch required for action=update"],
    ["task_tracker", { action: "replace" }, "tasks required for action=replace"],
    ["task_tracker", { action: "get", tasks: [] }, "tasks is not supported for action=get"],
  ])("returns structured invalid_input for %s", async (name, args, message) => {
    const tool = getTool(name);
    const result = await tool.execute("call-1", args);

    expect(callGatewayMock).not.toHaveBeenCalled();
    expect(result.details).toMatchObject({
      ok: false,
      success: false,
      code: "invalid_input",
      tool: name,
      message,
    });
  });

  it("returns structured invalid_input for canvas action-specific payloads", async () => {
    const tool = getTool("canvas");
    const result = await tool.execute("call-canvas", { action: "a2ui_push" });

    expect(callGatewayMock).not.toHaveBeenCalled();
    expect(result.details).toMatchObject({
      ok: false,
      success: false,
      code: "invalid_input",
      tool: "canvas",
      message: "jsonl or jsonlPath required for action=a2ui_push",
    });
  });

  it.each(["gateway", "canvas", "nodes", "cron", "task_tracker"])(
    "keeps %s schema provider-safe",
    (name) => {
      const tool = getTool(name);
      const schema = tool.parameters as {
        type?: unknown;
        anyOf?: unknown;
        oneOf?: unknown;
      };

      expect(schema.type).toBe("object");
      expect(schema.anyOf).toBeUndefined();
      expect(schema.oneOf).toBeUndefined();
    },
  );

  it("still accepts flattened cron.add job fields", async () => {
    const tool = getTool("cron", { agentSessionKey: "main" });
    await tool.execute("call-2", {
      action: "add",
      schedule: { at: new Date(123).toISOString() },
      payload: { kind: "systemEvent", text: "hello" },
    });

    expect(callGatewayMock).toHaveBeenCalledTimes(1);
    const call = callGatewayMock.mock.calls[0]?.[0] as {
      method?: string;
      params?: { payload?: { kind?: string; text?: string } };
    };
    expect(call.method).toBe("cron.add");
    expect(call.params?.payload).toEqual({
      kind: "systemEvent",
      text: "hello",
    });
  });
});
