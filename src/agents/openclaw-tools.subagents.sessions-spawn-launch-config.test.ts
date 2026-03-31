import { beforeEach, describe, expect, it, vi } from "vitest";

const stubTool = (name: string) => ({
  name,
  description: `${name} stub`,
  parameters: { type: "object", properties: {} },
  execute: vi.fn(),
});

const callGatewayMock = vi.fn();
vi.mock("../gateway/call.js", () => ({
  callGateway: (opts: unknown) => callGatewayMock(opts),
}));

let configOverride: ReturnType<(typeof import("../config/config.js"))["loadConfig"]> = {
  session: {
    mainKey: "main",
    scope: "per-sender",
  },
};

vi.mock("../config/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config/config.js")>();
  return {
    ...actual,
    loadConfig: () => configOverride,
    resolveGatewayPort: () => 18789,
  };
});

vi.mock("../infra/task-readiness.js", () => ({
  normalizeTaskReadiness: (value: unknown) => {
    if (value === "pause" || value === "block") {
      return value;
    }
    return "continue";
  },
}));

vi.mock("./tool-contracts.js", () => ({
  applyToolContracts: <T>(tool: T) => tool,
}));

vi.mock("./tools/get-task-output-tool.js", () => ({
  createTaskOutputTools: () => [],
}));

vi.mock("./tools/agents-list-tool.js", () => ({
  createAgentsListTool: () => stubTool("agents_list"),
}));

vi.mock("./tools/cron-tool.js", () => ({
  createCronTool: () => stubTool("cron"),
}));

vi.mock("./tools/delegate-tool.js", () => ({
  createDelegateTool: () => stubTool("delegate"),
}));

vi.mock("./tools/gateway-tool.js", () => ({
  createGatewayTool: () => stubTool("gateway"),
}));

vi.mock("./tools/message-tool.js", () => ({
  createMessageTool: () => stubTool("message"),
}));

vi.mock("./tools/nodes-tool.js", () => ({
  createNodesTool: () => stubTool("nodes"),
}));

vi.mock("./tools/session-status-tool.js", () => ({
  createSessionStatusTool: () => stubTool("session_status"),
}));

vi.mock("./tools/sessions-history-tool.js", () => ({
  createSessionsHistoryTool: () => stubTool("sessions_history"),
}));

vi.mock("./tools/sessions-list-tool.js", () => ({
  createSessionsListTool: () => stubTool("sessions_list"),
}));

vi.mock("./tools/sessions-send-tool.js", () => ({
  createSessionsSendTool: () => stubTool("sessions_send"),
}));

vi.mock("./tools/task-get-tool.js", () => ({
  createTaskGetTool: () => stubTool("task_get"),
}));

vi.mock("./tools/task-tracker-tool.js", () => ({
  createTaskTrackerTool: () => stubTool("task_tracker"),
}));

vi.mock("./tools/tasks-list-tool.js", () => ({
  createTasksListTool: () => stubTool("tasks_list"),
}));

vi.mock("./tools/tts-tool.js", () => ({
  createTtsTool: () => stubTool("tts"),
}));

import "./test-helpers/fast-core-tools.js";
import { createOpenClawTools } from "./openclaw-tools.js";
import { resetSubagentRegistryForTests } from "./subagent-registry.js";

describe("openclaw-tools: subagent launch config", () => {
  beforeEach(() => {
    resetSubagentRegistryForTests();
    callGatewayMock.mockReset();
    configOverride = {
      session: {
        mainKey: "main",
        scope: "per-sender",
      },
    };
  });

  it("uses deterministic child ids for the same tool call id", async () => {
    const agentCalls: Array<{
      sessionKey?: string;
      idempotencyKey?: string;
      lane?: string;
    }> = [];

    callGatewayMock.mockImplementation(async (opts: unknown) => {
      const request = opts as { method?: string; params?: unknown };
      if (request.method === "agent") {
        const params = request.params as {
          sessionKey?: string;
          idempotencyKey?: string;
          lane?: string;
        };
        agentCalls.push(params);
        return { runId: params.idempotencyKey ?? "run-1", status: "accepted" };
      }
      if (request.method === "agent.wait") {
        return { status: "timeout" };
      }
      return { ok: true };
    });

    const tool = createOpenClawTools({
      agentSessionKey: "agent:main:main",
      agentChannel: "discord",
    }).find((candidate) => candidate.name === "sessions_spawn");
    if (!tool) {
      throw new Error("missing sessions_spawn tool");
    }

    const first = await tool.execute("stable-call", {
      task: "inspect the repo",
    });
    const second = await tool.execute("stable-call", {
      task: "inspect the repo",
    });

    expect(first.details).toMatchObject({ status: "accepted" });
    expect(second.details).toMatchObject({ status: "accepted" });
    expect(agentCalls).toHaveLength(2);
    expect(agentCalls[0]?.lane).toBe("subagent");
    expect(agentCalls[0]?.sessionKey).toBe(agentCalls[1]?.sessionKey);
    expect(agentCalls[0]?.idempotencyKey).toBe(agentCalls[1]?.idempotencyKey);
    expect((first.details as { childSessionKey?: string }).childSessionKey).toBe(
      (second.details as { childSessionKey?: string }).childSessionKey,
    );
    expect((first.details as { runId?: string }).runId).toBe(
      (second.details as { runId?: string }).runId,
    );
  });

  it("returns the applied label after retrying a duplicate child label", async () => {
    callGatewayMock.mockImplementation(async (opts: unknown) => {
      const request = opts as { method?: string; params?: Record<string, unknown> };
      if (request.method === "sessions.patch") {
        if (request.params?.label === "worker") {
          throw new Error("label already in use: worker");
        }
        return { ok: true };
      }
      if (request.method === "agent") {
        return {
          runId: String(request.params?.idempotencyKey ?? "run-1"),
          status: "accepted",
        };
      }
      if (request.method === "agent.wait") {
        return { status: "timeout" };
      }
      return { ok: true };
    });

    const tool = createOpenClawTools({
      agentSessionKey: "agent:main:main",
      agentChannel: "discord",
    }).find((candidate) => candidate.name === "sessions_spawn");
    if (!tool) {
      throw new Error("missing sessions_spawn tool");
    }

    const result = await tool.execute("label-call", {
      task: "inspect the repo",
      label: "worker",
    });

    expect(result.details).toMatchObject({
      status: "accepted",
      labelApplied: "worker 2",
    });
  });
});
