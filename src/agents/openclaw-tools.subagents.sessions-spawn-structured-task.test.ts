import { beforeEach, describe, expect, it, vi } from "vitest";

const callGatewayMock = vi.fn();
vi.mock("../gateway/call.js", () => ({
  callGateway: (opts: unknown) => callGatewayMock(opts),
}));

vi.mock("../config/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config/config.js")>();
  return {
    ...actual,
    loadConfig: () => ({
      session: {
        mainKey: "main",
        scope: "per-sender",
      },
    }),
    resolveGatewayPort: () => 18789,
  };
});

import "./test-helpers/fast-core-tools.js";
import { resetSubagentRegistryForTests } from "./subagent-registry.js";
import { createSessionsSpawnTool } from "./tools/sessions-spawn-tool.js";

describe("sessions_spawn structured task specs", () => {
  beforeEach(() => {
    resetSubagentRegistryForTests();
    callGatewayMock.mockReset();
  });

  it("renders a self-contained implementation prompt and infers the implementation profile", async () => {
    callGatewayMock.mockImplementation(async (opts: unknown) => {
      const request = opts as { method?: string; params?: Record<string, unknown> };
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

    const tool = createSessionsSpawnTool({
      agentSessionKey: "agent:main:main",
      agentChannel: "discord",
    });

    const result = await tool.execute("structured-task", {
      task: "Fix the auth retry bug",
      taskType: "implementation",
      facts: [
        "src/auth/retry.ts retries forever after ECONNRESET on the first request.",
        "The retry loop should stop after the second network failure.",
      ],
      doneCriteria: [
        "Patch the retry guard in src/auth/retry.ts.",
        "Add or update regression coverage for the double-failure case.",
      ],
      filePaths: ["src/auth/retry.ts", "src/auth/retry.test.ts"],
      symbols: ["retryAuthRequest"],
      commands: ["pnpm vitest src/auth/retry.test.ts"],
    });

    expect(result.details).toMatchObject({
      status: "accepted",
      profile: "implementation",
      taskType: "implementation",
      taskStructured: true,
    });

    const agentCall = callGatewayMock.mock.calls.find(
      ([arg]) => (arg as { method?: string }).method === "agent",
    )?.[0] as { params?: { message?: string; extraSystemPrompt?: string } } | undefined;
    const message = agentCall?.params?.message ?? "";
    const extraSystemPrompt = agentCall?.params?.extraSystemPrompt ?? "";

    expect(message).toContain("# Worker Task Spec");
    expect(message).toContain("Task type: implementation");
    expect(message).toContain("Known Facts");
    expect(message).toContain("Done Criteria");
    expect(message).toContain("File Modification");
    expect(extraSystemPrompt).toContain("Available tools in this session:");
  });

  it("keeps planner-profile spawns read-only without forcing structured task specs", async () => {
    callGatewayMock.mockImplementation(async (opts: unknown) => {
      const request = opts as { method?: string; params?: Record<string, unknown> };
      if (request.method === "agent") {
        return {
          runId: String(request.params?.idempotencyKey ?? "run-2"),
          status: "accepted",
        };
      }
      if (request.method === "agent.wait") {
        return { status: "timeout" };
      }
      return { ok: true };
    });

    const tool = createSessionsSpawnTool({
      agentSessionKey: "agent:main:main",
      agentChannel: "discord",
    });

    const result = await tool.execute("structured-synthesis", {
      task: "Turn the auth retry research into an implementation brief",
      profile: "planner",
    });

    expect(result.details).toMatchObject({
      status: "accepted",
      profile: "planner",
      taskStructured: false,
    });

    const agentCall = callGatewayMock.mock.calls.find(
      ([arg]) => (arg as { method?: string }).method === "agent",
    )?.[0] as { params?: { message?: string; extraSystemPrompt?: string } } | undefined;
    expect(agentCall?.params?.message).toBe(
      "Turn the auth retry research into an implementation brief",
    );
    expect(agentCall?.params?.extraSystemPrompt ?? "").toContain("Profile: planner");
  });
});
