import { describe, expect, it } from "vitest";
import { createTuiTurnLifecycleStore } from "./tui-turn-lifecycle.js";

describe("tui turn lifecycle", () => {
  it("starts timing on reserve and preserves it through running phases", () => {
    let now = 1_000;
    const store = createTuiTurnLifecycleStore({ now: () => now });

    expect(store.reserve("run-1")).toBe(true);
    expect(store.getSnapshot()).toMatchObject({
      phase: "reserving",
      activeRunId: "run-1",
      activeSinceMs: 1_000,
      activityLabel: "sending",
      isTurnActive: true,
      isLoading: true,
    });

    now = 5_000;
    expect(store.markWaiting("run-1")).toBe(true);
    expect(store.markRunning("run-1")).toBe(true);
    expect(store.getSnapshot().activeSinceMs).toBe(1_000);
  });

  it("rejects double reserve while a turn is already active", () => {
    const store = createTuiTurnLifecycleStore();

    expect(store.reserve("run-1")).toBe(true);
    expect(store.reserve("run-2")).toBe(false);
    expect(store.getSnapshot().activeRunId).toBe("run-1");
  });

  it("ignores late active transitions after cancel during reserve", () => {
    const store = createTuiTurnLifecycleStore();

    expect(store.reserve("run-1")).toBe(true);
    expect(store.cancel("run-1")).toBe(true);
    expect(store.markWaiting("run-1")).toBe(false);
    expect(store.markRunning("run-1")).toBe(false);
    expect(store.getSnapshot()).toMatchObject({
      phase: "cancelled",
      activeRunId: null,
      activityLabel: "aborted",
    });
  });

  it("ignores late observed adoption for a terminal run", () => {
    const store = createTuiTurnLifecycleStore();

    expect(store.reserve("run-1")).toBe(true);
    expect(store.complete("run-1")).toBe(true);
    expect(store.adoptObservedRun("run-1", "streaming")).toBe(false);
    expect(store.getSnapshot().phase).toBe("completed");
  });

  it("derives loading from local and external work independently", () => {
    const store = createTuiTurnLifecycleStore();

    expect(store.getSnapshot().isLoading).toBe(false);
    expect(store.setExternalLoading(true)).toBe(true);
    expect(store.getSnapshot()).toMatchObject({
      isExternalLoading: true,
      isLoading: true,
      isTurnActive: false,
    });

    expect(store.reserve("run-1")).toBe(true);
    expect(store.complete("run-1")).toBe(true);
    expect(store.getSnapshot().isLoading).toBe(true);

    expect(store.setExternalLoading(false)).toBe(true);
    expect(store.getSnapshot().isLoading).toBe(false);
  });
});
