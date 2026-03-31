import { describe, expect, it } from "vitest";
import { createTelemetryStore } from "./telemetry-store.js";

describe("createTelemetryStore", () => {
  it("computes histogram percentiles from bounded samples", () => {
    const store = createTelemetryStore({
      reservoirSize: 16,
      random: () => 0,
    });

    for (let value = 1; value <= 16; value += 1) {
      store.observe("latency_ms", value);
    }

    expect(store.getAll().histograms.latency_ms).toEqual({
      count: 16,
      min: 1,
      max: 16,
      avg: 8.5,
      p50: 8.5,
      p95: 15.25,
      p99: 15.85,
      reservoirSize: 16,
    });
  });

  it("keeps the reservoir bounded", () => {
    const store = createTelemetryStore({
      reservoirSize: 8,
      random: () => 0.99,
    });

    for (let value = 1; value <= 64; value += 1) {
      store.observe("latency_ms", value);
    }

    const snapshot = store.getAll();
    expect(snapshot.histograms.latency_ms?.count).toBe(64);
    expect(snapshot.histograms.latency_ms?.reservoirSize).toBe(8);
  });

  it("tracks uniqueness counts without storing duplicates", () => {
    const store = createTelemetryStore();

    store.add("unique_tool_names", "grep");
    store.add("unique_tool_names", "grep");
    store.add("unique_tool_names", "ls");

    expect(store.getAll().cardinalities.unique_tool_names).toEqual({ count: 2 });
  });

  it("produces a serializable snapshot with counters and gauges", () => {
    let tick = 10;
    const store = createTelemetryStore({ now: () => tick });

    store.increment("error_count");
    tick = 20;
    store.set("active_overlay_count", 2);
    tick = 30;
    store.observe("prompt_to_done_ms", 150);

    const json = JSON.stringify(store.getAll());
    expect(JSON.parse(json)).toEqual({
      counters: { error_count: 1 },
      gauges: { active_overlay_count: 2 },
      histograms: {
        prompt_to_done_ms: {
          count: 1,
          min: 150,
          max: 150,
          avg: 150,
          p50: 150,
          p95: 150,
          p99: 150,
          reservoirSize: 1,
        },
      },
      cardinalities: {},
      updatedAt: 30,
    });
  });
});
