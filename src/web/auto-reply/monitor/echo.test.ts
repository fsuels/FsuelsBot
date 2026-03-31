import { describe, expect, it } from "vitest";
import { createEchoTracker } from "./echo.js";

describe("createEchoTracker", () => {
  it("tracks recent outbound message ids without consuming them on lookup", () => {
    const tracker = createEchoTracker({ maxItems: 5 });

    tracker.rememberMessageIds(["out-1", "out-2"]);

    expect(tracker.hasMessageId("out-1")).toBe(true);
    expect(tracker.hasMessageId("out-1")).toBe(true);
    expect(tracker.hasMessageId("out-2")).toBe(true);
    expect(tracker.hasMessageId("missing")).toBe(false);
  });

  it("bounds remembered message ids and evicts the oldest first", () => {
    const tracker = createEchoTracker({ maxItems: 2 });

    tracker.rememberMessageIds(["out-1"]);
    tracker.rememberMessageIds(["out-2"]);
    tracker.rememberMessageIds(["out-3"]);

    expect(tracker.hasMessageId("out-1")).toBe(false);
    expect(tracker.hasMessageId("out-2")).toBe(true);
    expect(tracker.hasMessageId("out-3")).toBe(true);
  });

  it("keeps existing text echo tracking behavior", () => {
    const tracker = createEchoTracker({ maxItems: 5 });

    tracker.rememberText("hello", {});

    expect(tracker.has("hello")).toBe(true);
    tracker.forget("hello");
    expect(tracker.has("hello")).toBe(false);
  });
});
