import { afterEach, describe, expect, it } from "vitest";
import {
  resolveAutoResetContextThreshold,
  shouldAutoResetSessionForContextPressure,
} from "./context-pressure.js";

describe("context pressure auto-reset", () => {
  afterEach(() => {
    delete process.env.OPENCLAW_CONTEXT_PRESSURE_RESET_THRESHOLD;
    delete process.env.OPENCLAW_CONTEXT_PRESSURE_AUTO_RESET;
  });

  it("uses default threshold when env is unset", () => {
    expect(resolveAutoResetContextThreshold()).toBe(0.85);
  });

  it("respects clamped env threshold", () => {
    process.env.OPENCLAW_CONTEXT_PRESSURE_RESET_THRESHOLD = "0.5";
    expect(resolveAutoResetContextThreshold()).toBe(0.6);
    process.env.OPENCLAW_CONTEXT_PRESSURE_RESET_THRESHOLD = "0.99";
    expect(resolveAutoResetContextThreshold()).toBe(0.98);
  });

  it("triggers reset when token usage crosses threshold", () => {
    expect(
      shouldAutoResetSessionForContextPressure(
        {
          sessionId: "s1",
          updatedAt: Date.now(),
          totalTokens: 850,
          contextTokens: 1000,
        },
        0.85,
      ),
    ).toBe(true);
    expect(
      shouldAutoResetSessionForContextPressure(
        {
          sessionId: "s1",
          updatedAt: Date.now(),
          totalTokens: 700,
          contextTokens: 1000,
        },
        0.85,
      ),
    ).toBe(false);
  });

  it("supports disabling auto-reset with env", () => {
    process.env.OPENCLAW_CONTEXT_PRESSURE_AUTO_RESET = "0";
    expect(
      shouldAutoResetSessionForContextPressure({
        sessionId: "s1",
        updatedAt: Date.now(),
        totalTokens: 990,
        contextTokens: 1000,
      }),
    ).toBe(false);
  });
});
