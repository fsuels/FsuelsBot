import { afterEach, describe, expect, it, vi } from "vitest";
import { __testing, getCapabilityAuthStatus, getCapabilityStatus } from "./capability-gate.js";

describe("capability gate", () => {
  afterEach(() => {
    __testing.clearCapabilityGateCache();
    vi.useRealTimers();
  });

  it("memoizes render-path evaluations until the cache expires", () => {
    vi.useFakeTimers();
    let calls = 0;
    const evaluate = () => {
      calls += 1;
      return {
        visible: true,
        auth: getCapabilityAuthStatus({ ok: true }),
      };
    };

    const first = getCapabilityStatus({
      capability: "web_search",
      mode: "render",
      cacheKey: "search",
      evaluate,
    });
    const second = getCapabilityStatus({
      capability: "web_search",
      mode: "render",
      cacheKey: "search",
      evaluate,
    });

    expect(calls).toBe(1);
    expect(first.cacheState).toBe("missing");
    expect(second.cacheState).toBe("fresh");

    vi.advanceTimersByTime(5_001);

    const third = getCapabilityStatus({
      capability: "web_search",
      mode: "render",
      cacheKey: "search",
      evaluate,
    });

    expect(calls).toBe(2);
    expect(third.cacheState).toBe("missing");
  });

  it("always re-evaluates runtime checks", () => {
    let calls = 0;
    const evaluate = () => {
      calls += 1;
      return {
        visible: true,
        auth: getCapabilityAuthStatus({ ok: true }),
      };
    };

    getCapabilityStatus({
      capability: "image",
      mode: "render",
      cacheKey: "image",
      evaluate,
    });
    getCapabilityStatus({
      capability: "image",
      mode: "runtime",
      cacheKey: "image",
      evaluate,
    });

    expect(calls).toBe(2);
  });
});
