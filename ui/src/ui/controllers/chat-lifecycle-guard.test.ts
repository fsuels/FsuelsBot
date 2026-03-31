import { describe, expect, it } from "vitest";
import { createChatLifecycleGuard } from "./chat-lifecycle-guard.ts";

describe("chat lifecycle guard", () => {
  it("tracks reservation, start, and end through a single authoritative snapshot", () => {
    const guard = createChatLifecycleGuard();

    expect(guard.getSnapshot()).toMatchObject({
      phase: "idle",
      runId: null,
      generation: null,
      busy: false,
    });

    expect(guard.reserve()).toBe(true);
    expect(guard.getSnapshot()).toMatchObject({
      phase: "reserved",
      runId: null,
      generation: null,
      busy: true,
    });

    const generation = guard.tryStart("run-1");
    expect(generation).toBe(1);
    expect(guard.getSnapshot()).toMatchObject({
      phase: "active",
      runId: "run-1",
      generation: 1,
      busy: true,
    });

    expect(guard.end(generation!)).toBe(true);
    expect(guard.getSnapshot()).toMatchObject({
      phase: "idle",
      runId: null,
      generation: null,
      busy: false,
    });
  });

  it("rejects stale generation tokens from older runs", () => {
    const guard = createChatLifecycleGuard();

    expect(guard.reserve()).toBe(true);
    const firstGeneration = guard.tryStart("run-1");
    expect(firstGeneration).toBe(1);

    guard.forceEnd();

    expect(guard.reserve()).toBe(true);
    const secondGeneration = guard.tryStart("run-2");
    expect(secondGeneration).toBe(2);

    expect(guard.end(firstGeneration!)).toBe(false);
    expect(guard.getSnapshot()).toMatchObject({
      phase: "active",
      runId: "run-2",
      generation: 2,
      busy: true,
    });
  });
});
