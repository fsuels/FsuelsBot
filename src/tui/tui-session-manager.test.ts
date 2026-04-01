import { describe, expect, it, vi } from "vitest";
import { createTuiSessionManager } from "./tui-session-manager.js";

describe("createTuiSessionManager", () => {
  it("ignores duplicate resize events with identical dimensions", () => {
    const requestRender = vi.fn();
    const onResizeSync = vi.fn();
    const stdout = { columns: 80, rows: 24 } as NodeJS.WriteStream;
    const manager = createTuiSessionManager({
      tui: {
        requestRender,
        stop: vi.fn(),
        invalidate: vi.fn(),
      } as never,
      terminal: { drainInput: vi.fn().mockResolvedValue(undefined) } as never,
      stdout,
      stderr: { write: vi.fn(() => true) } as never,
      onResizeSync,
    });

    manager.activate();
    manager.handleResize();
    stdout.columns = 100;
    manager.handleResize();
    manager.handleResize();

    expect(onResizeSync).toHaveBeenCalledTimes(1);
    expect(requestRender).toHaveBeenCalledTimes(1);
  });

  it("can invalidate the previous frame without forcing a clear", () => {
    const tui = {
      requestRender: vi.fn(),
      stop: vi.fn(),
      invalidate: vi.fn(),
      previousLines: ["hello"],
      previousWidth: 120,
      cursorRow: 5,
      hardwareCursorRow: 5,
      previousViewportTop: 3,
    };
    const manager = createTuiSessionManager({
      tui: tui as never,
      terminal: { drainInput: vi.fn().mockResolvedValue(undefined) } as never,
      stdout: { columns: 80, rows: 24 } as never,
      stderr: { write: vi.fn(() => true) } as never,
    });

    manager.invalidatePrevFrame();

    expect(tui.previousLines).toEqual([]);
    expect(tui.previousWidth).toBe(80);
    expect(tui.cursorRow).toBe(0);
    expect(tui.hardwareCursorRow).toBe(0);
    expect(tui.invalidate).toHaveBeenCalledTimes(1);
    expect(tui.requestRender).toHaveBeenCalledWith();
  });

  it("captures stray stderr writes and schedules a recovery repaint", async () => {
    const originalWrite = vi.fn(() => true);
    const stderr = { write: originalWrite } as never;
    const requestRender = vi.fn();
    const manager = createTuiSessionManager({
      tui: {
        requestRender,
        stop: vi.fn(),
        invalidate: vi.fn(),
      } as never,
      terminal: { drainInput: vi.fn().mockResolvedValue(undefined) } as never,
      stdout: { columns: 80, rows: 24 } as never,
      stderr,
    });

    manager.activate();
    const callback = vi.fn();
    stderr.write("hello from stderr", callback);
    await Promise.resolve();

    expect(originalWrite).not.toHaveBeenCalledWith("hello from stderr", callback);
    expect(requestRender).toHaveBeenCalledWith(true);
    expect(callback).toHaveBeenCalledWith(null);
    expect(manager.getCapturedStderrWrites()).toEqual(["hello from stderr"]);
  });

  it("drains input, stops the tui, and restores stderr interception once", async () => {
    const originalWrite = vi.fn(() => true);
    const stderr = { write: originalWrite } as never;
    const drainInput = vi.fn().mockResolvedValue(undefined);
    const stop = vi.fn();
    const manager = createTuiSessionManager({
      tui: {
        requestRender: vi.fn(),
        stop,
        invalidate: vi.fn(),
      } as never,
      terminal: { drainInput } as never,
      stdout: { columns: 80, rows: 24 } as never,
      stderr,
    });

    manager.activate();
    stderr.write("captured");
    await Promise.resolve();
    await manager.cleanup("test");
    await manager.cleanup("test");

    expect(drainInput).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(originalWrite).toHaveBeenCalledWith(
      expect.stringContaining("[openclaw:tui] captured 1 stderr write(s)"),
    );
  });
});
