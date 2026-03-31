import type { Component } from "@mariozechner/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { createOverlayHandlers, handleOverlayEscape } from "./tui-overlays.js";

class DummyComponent implements Component {
  render() {
    return ["dummy"];
  }

  invalidate() {}
}

describe("createOverlayHandlers", () => {
  it("routes overlays through the TUI overlay stack", () => {
    const showOverlay = vi.fn();
    const hideOverlay = vi.fn();
    const setFocus = vi.fn();
    let open = false;

    const host = {
      showOverlay: (component: Component) => {
        open = true;
        showOverlay(component);
      },
      hideOverlay: () => {
        open = false;
        hideOverlay();
      },
      hasOverlay: () => open,
      setFocus,
    };

    const { openOverlay, closeOverlay } = createOverlayHandlers(host, new DummyComponent());
    const overlay = new DummyComponent();

    openOverlay(overlay);
    expect(showOverlay).toHaveBeenCalledWith(overlay);
    expect(setFocus).toHaveBeenCalledWith(overlay);

    closeOverlay();
    expect(hideOverlay).toHaveBeenCalledTimes(1);
    expect(setFocus).toHaveBeenLastCalledWith(expect.any(DummyComponent));
  });

  it("restores focus when closing without an overlay", () => {
    const setFocus = vi.fn();
    const host = {
      showOverlay: vi.fn(),
      hideOverlay: vi.fn(),
      hasOverlay: () => false,
      setFocus,
    };
    const fallback = new DummyComponent();

    const { closeOverlay } = createOverlayHandlers(host, fallback);
    closeOverlay();

    expect(setFocus).toHaveBeenCalledWith(fallback);
  });

  it("reports whether an overlay is active", () => {
    let open = false;
    const host = {
      showOverlay: vi.fn(() => {
        open = true;
      }),
      hideOverlay: vi.fn(() => {
        open = false;
      }),
      hasOverlay: () => open,
      setFocus: vi.fn(),
    };

    const { openOverlay, closeOverlay, hasActiveOverlay } = createOverlayHandlers(
      host,
      new DummyComponent(),
    );

    expect(hasActiveOverlay()).toBe(false);
    openOverlay(new DummyComponent());
    expect(hasActiveOverlay()).toBe(true);
    closeOverlay();
    expect(hasActiveOverlay()).toBe(false);
  });

  it("closes an active overlay before aborting on Escape", () => {
    const closeOverlay = vi.fn();
    const abortActive = vi.fn();
    const requestRender = vi.fn();

    const result = handleOverlayEscape({
      hasActiveOverlay: () => true,
      closeOverlay,
      abortActive,
      requestRender,
    });

    expect(result).toBe("overlay");
    expect(closeOverlay).toHaveBeenCalledTimes(1);
    expect(requestRender).toHaveBeenCalledTimes(1);
    expect(abortActive).not.toHaveBeenCalled();
  });

  it("falls through to abort when no overlay is active", () => {
    const closeOverlay = vi.fn();
    const abortActive = vi.fn();

    const result = handleOverlayEscape({
      hasActiveOverlay: () => false,
      closeOverlay,
      abortActive,
    });

    expect(result).toBe("abort");
    expect(closeOverlay).not.toHaveBeenCalled();
    expect(abortActive).toHaveBeenCalledTimes(1);
  });
});
