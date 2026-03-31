import { describe, expect, it } from "vitest";
import { memoryAge, memoryAgeDays, memoryFreshnessNote, memoryFreshnessText } from "./freshness.js";

describe("memory freshness helpers", () => {
  const now = Date.parse("2026-03-31T12:00:00.000Z");

  it("formats age buckets for today, yesterday, and older memories", () => {
    expect(memoryAge(now, now)).toBe("today");
    expect(memoryAge(now - 24 * 60 * 60 * 1000, now)).toBe("yesterday");
    expect(memoryAge(now - 3 * 24 * 60 * 60 * 1000, now)).toBe("3 days ago");
  });

  it("computes age in whole days", () => {
    expect(memoryAgeDays(now - 47 * 60 * 60 * 1000, now)).toBe(1);
    expect(memoryAgeDays(now - 49 * 60 * 60 * 1000, now)).toBe(2);
  });

  it("adds a stale-memory note only after the first day", () => {
    expect(memoryFreshnessText(now - 2 * 24 * 60 * 60 * 1000, now)).toBe("Recorded 2 days ago.");
    expect(memoryFreshnessNote(now, now)).toBeUndefined();
    expect(memoryFreshnessNote(now - 24 * 60 * 60 * 1000, now)).toBeUndefined();
    expect(memoryFreshnessNote(now - 2 * 24 * 60 * 60 * 1000, now)).toContain(
      "Point-in-time observation",
    );
  });
});
