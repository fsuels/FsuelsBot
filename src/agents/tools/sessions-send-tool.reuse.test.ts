import { beforeEach, describe, expect, it, vi } from "vitest";

const callGatewayMock = vi.fn();
const loadSessionEntryMock = vi.fn();

vi.mock("../../gateway/call.js", () => ({
  callGateway: (opts: unknown) => callGatewayMock(opts),
}));

vi.mock("../../gateway/session-utils.js", () => ({
  loadSessionEntry: (sessionKey: string) => loadSessionEntryMock(sessionKey),
}));

vi.mock("../pi-embedded.js", () => ({
  isEmbeddedPiRunActive: () => false,
  queueEmbeddedPiMessage: () => false,
  waitForEmbeddedPiRunEnd: async () => false,
}));

vi.mock("../../config/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../config/config.js")>();
  return {
    ...actual,
    loadConfig: () =>
      ({
        session: {
          mainKey: "main",
          scope: "per-sender",
          agentToAgent: { maxPingPongTurns: 0 },
        },
      }) as never,
  };
});

import { addSubagentRunForTests, resetSubagentRegistryForTests } from "../subagent-registry.js";
import { createSessionsSendTool } from "./sessions-send-tool.js";

describe("sessions_send reuse guard", () => {
  beforeEach(() => {
    callGatewayMock.mockReset();
    loadSessionEntryMock.mockReset();
    resetSubagentRegistryForTests();
  });

  it("rejects verification follow-ups that should use a fresh worker", async () => {
    loadSessionEntryMock.mockReturnValue({
      canonicalKey: "agent:main:worker",
      entry: { sessionId: "worker-session" },
    });
    addSubagentRunForTests({
      runId: "run-impl",
      childSessionKey: "agent:main:worker",
      requesterSessionKey: "agent:main:main",
      requesterDisplayKey: "main",
      task: "Implement the retry fix",
      taskSummary: "Implement the retry fix",
      taskType: "implementation",
      filePaths: ["src/auth/retry.ts"],
      cleanup: "keep",
      profile: "implementation",
      createdAt: Date.now(),
    });

    const tool = createSessionsSendTool({
      agentSessionKey: "agent:main:main",
      agentChannel: "discord",
    });

    const result = await tool.execute("reuse-guard", {
      sessionKey: "agent:main:worker",
      message: "Verify the retry fix independently.",
      taskType: "verification",
      facts: [
        "The implementation worker changed src/auth/retry.ts to stop retrying after the second ECONNRESET.",
      ],
      doneCriteria: ["Run the retry regression tests and report concrete evidence."],
      filePaths: ["src/auth/retry.ts"],
      sourceTaskId: "run-impl",
    });

    expect(result.details).toMatchObject({
      status: "error",
      sessionKey: "agent:main:worker",
      reuseDecision: {
        action: "spawn_fresh",
        reasonCode: "verification_requires_independence",
      },
    });
    expect(String((result.details as { error?: string }).error)).toContain("sessions_spawn");
    const gatewayMethods = callGatewayMock.mock.calls.map(
      ([arg]) => (arg as { method?: string }).method,
    );
    expect(gatewayMethods).not.toContain("agent");
  });
});
