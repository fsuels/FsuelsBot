import { afterEach, describe, expect, it } from "vitest";
import { resetSleepRegistryForTests } from "../sleep-registry.js";
import { createSleepTool } from "./sleep-tool.js";

afterEach(() => {
  resetSleepRegistryForTests();
});

describe("sleep tool", () => {
  it("uses the canonical sleep tool id", () => {
    expect(createSleepTool({ agentSessionKey: "agent:main:main" }).name).toBe("sleep");
  });

  it("rejects invalid wait specifications", async () => {
    const tool = createSleepTool({ agentSessionKey: "agent:main:main" });

    const negative = await tool.validateInput?.(
      {
        durationMs: -1,
      },
      {
        toolCallId: "sleep-invalid-1",
        source: "direct",
      },
    );
    expect(negative).toMatchObject({
      result: false,
      code: "invalid_input",
      message: expect.stringMatching(/positive number/i),
    });

    const conflicting = await tool.validateInput?.(
      {
        durationMs: 1000,
        until: new Date(Date.now() + 2000).toISOString(),
      },
      {
        toolCallId: "sleep-invalid-2",
        source: "direct",
      },
    );
    expect(conflicting).toMatchObject({
      result: false,
      code: "invalid_input",
      message: expect.stringMatching(/exactly one of durationMs or until/i),
    });
  });

  it("accepts future ISO wake times", async () => {
    const tool = createSleepTool({ agentSessionKey: "agent:main:main" });

    const validation = await tool.validateInput?.(
      {
        until: new Date(Date.now() + 2_000).toISOString(),
        reason: "wait for follow-up",
      },
      {
        toolCallId: "sleep-valid-validate",
        source: "direct",
      },
    );

    expect(validation).toMatchObject({
      result: true,
    });

    const result = await tool.execute("sleep-valid", {
      until: new Date(Date.now() + 5_000).toISOString(),
      reason: "wait for follow-up",
    });

    expect(result.details).toMatchObject({
      ok: true,
      status: "scheduled",
      sessionKey: "agent:main:main",
      reason: "wait for follow-up",
      persistence: "memory_only",
    });
  });
});
