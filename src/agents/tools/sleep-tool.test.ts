import { afterEach, describe, expect, it } from "vitest";
import "../test-helpers/fast-core-tools.js";
import { createOpenClawTools } from "../openclaw-tools.js";
import { resetSleepRegistryForTests } from "../sleep-registry.js";
import { applyToolContracts } from "../tool-contracts.js";
import { createSleepTool } from "./sleep-tool.js";

afterEach(() => {
  resetSleepRegistryForTests();
});

describe("sleep tool", () => {
  it("is exposed in the OpenClaw tool list", () => {
    const tools = createOpenClawTools({ agentSessionKey: "agent:main:main" });

    expect(tools.some((tool) => tool.name === "sleep")).toBe(true);
  });

  it("rejects invalid wait specifications", async () => {
    const tool = applyToolContracts(createSleepTool({ agentSessionKey: "agent:main:main" }));

    const negative = await tool.execute("sleep-invalid-1", {
      durationMs: -1,
    });
    expect(negative.details).toMatchObject({
      ok: false,
      code: "invalid_input",
      error: expect.stringMatching(/positive number/i),
    });

    const conflicting = await tool.execute("sleep-invalid-2", {
      durationMs: 1000,
      until: new Date(Date.now() + 2000).toISOString(),
    });
    expect(conflicting.details).toMatchObject({
      ok: false,
      code: "invalid_input",
      error: expect.stringMatching(/exactly one of durationMs or until/i),
    });
  });

  it("accepts future ISO wake times", async () => {
    const tool = applyToolContracts(createSleepTool({ agentSessionKey: "agent:main:main" }));

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
