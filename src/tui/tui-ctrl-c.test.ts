import { describe, expect, it } from "vitest";
import { resolveTuiCtrlCAction } from "./tui-ctrl-c.js";

describe("resolveTuiCtrlCAction", () => {
  it("closes overlays before applying any exit policy", () => {
    expect(
      resolveTuiCtrlCAction({
        nowMs: 2_000,
        lastCtrlCAt: 500,
        mode: "abort-or-exit",
        hasActiveOverlay: true,
        hasEditorText: true,
        hasActiveRun: true,
      }),
    ).toEqual({
      action: "close-overlay",
      nextLastCtrlCAt: 0,
      statusText: "closed overlay",
    });
  });

  it("clears editor text before exiting", () => {
    expect(
      resolveTuiCtrlCAction({
        nowMs: 2_000,
        lastCtrlCAt: 0,
        mode: "exit",
        hasActiveOverlay: false,
        hasEditorText: true,
        hasActiveRun: false,
      }),
    ).toEqual({
      action: "clear-input",
      nextLastCtrlCAt: 0,
      statusText: "cleared input",
    });
  });

  it("aborts an active run before exiting when configured", () => {
    expect(
      resolveTuiCtrlCAction({
        nowMs: 2_000,
        lastCtrlCAt: 0,
        mode: "abort-or-exit",
        hasActiveOverlay: false,
        hasEditorText: false,
        hasActiveRun: true,
      }),
    ).toEqual({
      action: "abort",
      nextLastCtrlCAt: 0,
      statusText: "aborting run",
    });
  });

  it("arms and then exits in double-press mode", () => {
    expect(
      resolveTuiCtrlCAction({
        nowMs: 1_000,
        lastCtrlCAt: 0,
        mode: "double-press-exit",
        hasActiveOverlay: false,
        hasEditorText: false,
        hasActiveRun: false,
      }),
    ).toEqual({
      action: "arm-exit",
      nextLastCtrlCAt: 1_000,
      statusText: "press ctrl+c again to exit",
    });

    expect(
      resolveTuiCtrlCAction({
        nowMs: 1_600,
        lastCtrlCAt: 1_000,
        mode: "double-press-exit",
        hasActiveOverlay: false,
        hasEditorText: false,
        hasActiveRun: false,
      }),
    ).toEqual({
      action: "exit",
      nextLastCtrlCAt: 0,
    });
  });

  it("exits immediately when configured to do so", () => {
    expect(
      resolveTuiCtrlCAction({
        nowMs: 1_000,
        lastCtrlCAt: 0,
        mode: "exit",
        hasActiveOverlay: false,
        hasEditorText: false,
        hasActiveRun: false,
      }),
    ).toEqual({
      action: "exit",
      nextLastCtrlCAt: 0,
    });
  });
});
