import { beforeEach, describe, expect, it, vi } from "vitest";

const callGatewayMock = vi.fn();
vi.mock("../../gateway/call.js", () => ({
  callGateway: (opts: unknown) => callGatewayMock(opts),
}));

vi.mock("../../config/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../config/config.js")>();
  return {
    ...actual,
    loadConfig: () =>
      ({
        session: { scope: "per-sender", mainKey: "main" },
        tools: { agentToAgent: { enabled: false } },
      }) as never,
  };
});

import { addSubagentRunForTests, resetSubagentRegistryForTests } from "../subagent-registry.js";
import { applyToolContracts } from "../tool-contracts.js";
import { createSessionsSendTool } from "./sessions-send-tool.js";

describe("sessions_send gating", () => {
  beforeEach(() => {
    callGatewayMock.mockReset();
    resetSubagentRegistryForTests();
  });

  it("rejects invalid whitespace-only labels before execution", async () => {
    const tool = applyToolContracts(
      createSessionsSendTool({
        agentSessionKey: "agent:main:main",
        agentChannel: "whatsapp",
      }),
    );

    const result = await tool.execute("call-invalid-label", {
      label: "   ",
      message: "hi",
      timeoutSeconds: 0,
    });

    expect(callGatewayMock).not.toHaveBeenCalled();
    expect(result.details).toMatchObject({
      ok: false,
      success: false,
      code: "invalid_input",
      tool: "sessions_send",
      message: "invalid label: empty",
    });
  });

  it("blocks cross-agent sends when tools.agentToAgent.enabled is false", async () => {
    const tool = applyToolContracts(
      createSessionsSendTool({
        agentSessionKey: "agent:main:main",
        agentChannel: "whatsapp",
      }),
    );

    const result = await tool.execute("call1", {
      sessionKey: "agent:other:main",
      message: "hi",
      timeoutSeconds: 0,
    });

    const calledMethods = callGatewayMock.mock.calls.map(
      ([arg]) => (arg as { method?: string }).method,
    );
    expect(calledMethods).not.toContain("agent");
    expect(result.details).toMatchObject({ status: "forbidden" });
  });

  it("rejects verification follow-ups that should use a fresh worker", async () => {
    addSubagentRunForTests({
      runId: "worker-1",
      childSessionKey: "agent:main:worker",
      requesterSessionKey: "agent:main:main",
      requesterDisplayKey: "main",
      task: "Fix auth retry bug",
      taskSummary: "Fix auth retry bug",
      taskType: "implementation",
      filePaths: ["src/auth/retry.ts"],
      cleanup: "keep",
      createdAt: Date.now(),
    });

    const tool = applyToolContracts(
      createSessionsSendTool({
        agentSessionKey: "agent:main:main",
        agentChannel: "whatsapp",
      }),
    );

    const result = await tool.execute("call-fresh-verifier", {
      sessionKey: "agent:main:worker",
      message: "Verify the auth retry fix",
      taskType: "verification",
      facts: ["src/auth/retry.ts was patched to stop retrying after the second failure."],
      doneCriteria: ["Run the auth retry regression test."],
      filePaths: ["src/auth/retry.ts"],
      sourceTaskId: "worker-1",
      timeoutSeconds: 0,
    });

    const calledMethods = callGatewayMock.mock.calls.map(
      ([arg]) => (arg as { method?: string }).method,
    );
    expect(calledMethods).not.toContain("agent");
    expect(result.details).toMatchObject({
      status: "error",
      reuseDecision: {
        action: "spawn_fresh",
        reasonCode: "verification_requires_independence",
      },
    });
    expect((result.details as { error?: string }).error).toContain("use sessions_spawn");
  });
});
