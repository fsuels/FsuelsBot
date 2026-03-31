import { describe, expect, it } from "vitest";
import { createUiTelemetry } from "./telemetry.ts";

function createMemoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

describe("createUiTelemetry", () => {
  it("records prompt, tool, and overlay metrics and persists the last-session snapshot", () => {
    let now = 100;
    const storage = createMemoryStorage();
    const telemetry = createUiTelemetry({
      now: () => now,
      storage,
      win: null,
    });

    telemetry.notePromptStarted("run-1", now);
    now = 140;
    telemetry.noteFirstToken("run-1", now);
    now = 220;
    telemetry.noteCancelRequested("run-1", now);
    telemetry.noteToolStarted("tool-1", "grep", 150);
    now = 260;
    telemetry.noteToolFinished("tool-1", now);
    now = 320;
    telemetry.notePromptFinished("run-1", now);
    telemetry.noteOverlayCount(2);
    telemetry.flush("last-session");

    const snapshot = telemetry.getAll();
    expect(snapshot.histograms.prompt_to_first_token_ms?.p50).toBe(40);
    expect(snapshot.histograms.prompt_to_done_ms?.p50).toBe(220);
    expect(snapshot.histograms.cancel_latency_ms?.p50).toBe(100);
    expect(snapshot.histograms.tool_call_ms?.p50).toBe(110);
    expect(snapshot.gauges.active_overlay_count).toBe(2);
    expect(snapshot.cardinalities.unique_tool_names?.count).toBe(1);

    const persisted = storage.getItem("openclaw.ui.telemetry.last-session");
    expect(persisted).not.toBeNull();
    expect(telemetry.getLastSessionSnapshot()).toEqual(JSON.parse(persisted ?? "{}"));
  });

  it("loads the previously persisted last-session snapshot", () => {
    const storage = createMemoryStorage();
    storage.setItem(
      "openclaw.ui.telemetry.last-session",
      JSON.stringify({
        counters: { error_count: 2 },
        gauges: { active_overlay_count: 0 },
        histograms: {},
        cardinalities: {},
        updatedAt: 12,
      }),
    );

    const telemetry = createUiTelemetry({
      storage,
      win: null,
    });

    expect(telemetry.getLastSessionSnapshot()).toEqual({
      counters: { error_count: 2 },
      gauges: { active_overlay_count: 0 },
      histograms: {},
      cardinalities: {},
      updatedAt: 12,
    });
  });
});
