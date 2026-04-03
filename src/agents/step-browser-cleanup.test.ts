import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearAllStepStatesForTests,
  maybeCleanupBrowserStateOnStepTransition,
} from "./step-browser-cleanup.js";

const trackedRoute = {
  target: "host" as const,
  profile: "chrome",
  targetId: "tab-1",
  updatedAt: 1,
};

describe("step browser cleanup", () => {
  afterEach(() => {
    clearAllStepStatesForTests();
    vi.clearAllMocks();
  });

  it("records the first step without clearing", async () => {
    const getBrowserSessionRoute = vi.fn(() => trackedRoute);
    const clearObservedBrowserStateForRoute = vi.fn(async () => {});

    const didClear = await maybeCleanupBrowserStateOnStepTransition({
      sessionKey: "agent:main:test",
      currentStepIndex: 0,
      currentDomain: "browser",
      deps: {
        getBrowserSessionRoute,
        clearObservedBrowserStateForRoute,
      },
    });

    expect(didClear).toBe(false);
    expect(getBrowserSessionRoute).not.toHaveBeenCalled();
    expect(clearObservedBrowserStateForRoute).not.toHaveBeenCalled();
  });

  it("clears observed browser state between browser steps", async () => {
    const getBrowserSessionRoute = vi.fn(() => trackedRoute);
    const clearObservedBrowserStateForRoute = vi.fn(async () => {});

    await maybeCleanupBrowserStateOnStepTransition({
      sessionKey: "agent:main:test",
      currentStepIndex: 0,
      currentDomain: "browser",
      deps: {
        getBrowserSessionRoute,
        clearObservedBrowserStateForRoute,
      },
    });
    const didClear = await maybeCleanupBrowserStateOnStepTransition({
      sessionKey: "agent:main:test",
      currentStepIndex: 1,
      currentDomain: "browser",
      deps: {
        getBrowserSessionRoute,
        clearObservedBrowserStateForRoute,
      },
    });

    expect(didClear).toBe(true);
    expect(getBrowserSessionRoute).toHaveBeenCalledWith("agent:main:test");
    expect(clearObservedBrowserStateForRoute).toHaveBeenCalledWith(trackedRoute);
  });

  it("skips cleanup when a transition needs clearing but no route is tracked", async () => {
    const getBrowserSessionRoute = vi.fn(() => undefined);
    const clearObservedBrowserStateForRoute = vi.fn(async () => {});

    await maybeCleanupBrowserStateOnStepTransition({
      sessionKey: "agent:main:test",
      currentStepIndex: 0,
      currentDomain: "shell",
      deps: {
        getBrowserSessionRoute,
        clearObservedBrowserStateForRoute,
      },
    });
    const didClear = await maybeCleanupBrowserStateOnStepTransition({
      sessionKey: "agent:main:test",
      currentStepIndex: 1,
      currentDomain: "browser",
      deps: {
        getBrowserSessionRoute,
        clearObservedBrowserStateForRoute,
      },
    });

    expect(didClear).toBe(false);
    expect(getBrowserSessionRoute).toHaveBeenCalledWith("agent:main:test");
    expect(clearObservedBrowserStateForRoute).not.toHaveBeenCalled();
  });

  it("does not clear when the step index has not changed", async () => {
    const getBrowserSessionRoute = vi.fn(() => trackedRoute);
    const clearObservedBrowserStateForRoute = vi.fn(async () => {});

    await maybeCleanupBrowserStateOnStepTransition({
      sessionKey: "agent:main:test",
      currentStepIndex: 2,
      currentDomain: "browser",
      deps: {
        getBrowserSessionRoute,
        clearObservedBrowserStateForRoute,
      },
    });
    const didClear = await maybeCleanupBrowserStateOnStepTransition({
      sessionKey: "agent:main:test",
      currentStepIndex: 2,
      currentDomain: "browser",
      deps: {
        getBrowserSessionRoute,
        clearObservedBrowserStateForRoute,
      },
    });

    expect(didClear).toBe(false);
    expect(getBrowserSessionRoute).not.toHaveBeenCalled();
    expect(clearObservedBrowserStateForRoute).not.toHaveBeenCalled();
  });
});
