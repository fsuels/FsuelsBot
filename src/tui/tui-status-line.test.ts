import { describe, expect, it } from "vitest";
import {
  buildBusyStatusLine,
  buildIdleStatusLine,
  resolveStatusTickMs,
} from "./tui-status-line.js";

const theme = {
  dim: (value: string) => `<d>${value}</d>`,
  bold: (value: string) => `<b>${value}</b>`,
  accentSoft: (value: string) => `<a>${value}</a>`,
};

describe("tui status line", () => {
  it("ticks faster while waiting than while running", () => {
    expect(
      resolveStatusTickMs(
        {
          phase: "running",
          runId: "run-1",
          activeRunId: "run-1",
          activeSinceMs: 0,
          activityLabel: "waiting",
          isExternalLoading: false,
          isTurnActive: true,
          isLoading: true,
        },
        Date.now(),
      ),
    ).toBe(200);

    expect(
      resolveStatusTickMs(
        {
          phase: "running",
          runId: "run-1",
          activeRunId: "run-1",
          activeSinceMs: 0,
          activityLabel: "running",
          isExternalLoading: false,
          isTurnActive: true,
          isLoading: true,
        },
        Date.now(),
      ),
    ).toBe(1_000);
  });

  it("formats busy and idle lines with elapsed and connection state", () => {
    const busy = buildBusyStatusLine({
      snapshot: {
        phase: "running",
        runId: "run-1",
        activeRunId: "run-1",
        activeSinceMs: 2_000,
        activityLabel: "running",
        isExternalLoading: false,
        isTurnActive: true,
        isLoading: true,
      },
      connectionStatus: "connected",
      width: 80,
      theme,
      nowMs: 65_000,
      tick: 0,
    });
    const idle = buildIdleStatusLine({
      connectionStatus: "connected",
      activityStatus: "idle",
      width: 80,
      theme,
    });

    expect(busy).toContain("connected");
    expect(busy).toContain("running");
    expect(busy).toContain("1m");
    expect(idle).toContain("idle");
    expect(idle).toContain("connected");
  });
});
