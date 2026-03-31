import { describe, expect, it, vi } from "vitest";
import { createOverlayCoordinator } from "./overlay-coordinator.js";

describe("createOverlayCoordinator", () => {
  it("closes the most recently activated overlay first", () => {
    const coordinator = createOverlayCoordinator();
    const closeSidebar = vi.fn();
    const closeModal = vi.fn();

    coordinator.activate({ id: "sidebar", kind: "non-modal", close: closeSidebar });
    coordinator.activate({ id: "dialog", kind: "modal", close: closeModal });

    expect(coordinator.closeTopOverlay()).toBe(true);
    expect(closeModal).toHaveBeenCalledTimes(1);
    expect(closeSidebar).not.toHaveBeenCalled();
  });

  it("tracks modal overlays separately from non-modal overlays", () => {
    const coordinator = createOverlayCoordinator();

    coordinator.activate({ id: "sidebar", kind: "non-modal", close: vi.fn() });
    expect(coordinator.isOverlayActive()).toBe(true);
    expect(coordinator.isModalOverlayActive()).toBe(false);

    coordinator.activate({ id: "dialog", kind: "modal", close: vi.fn() });
    expect(coordinator.isModalOverlayActive()).toBe(true);
    expect(coordinator.getSnapshot()).toEqual({
      activeIds: ["sidebar", "dialog"],
      modalIds: ["dialog"],
      topOverlayId: "dialog",
    });
  });

  it("can close the newest modal without closing a newer non-modal overlay", () => {
    const coordinator = createOverlayCoordinator();
    const closeSidebar = vi.fn();
    const closeDialog = vi.fn();

    coordinator.activate({ id: "dialog", kind: "modal", close: closeDialog });
    coordinator.activate({ id: "sidebar", kind: "non-modal", close: closeSidebar });

    expect(coordinator.closeTopModalOverlay()).toBe(true);
    expect(closeDialog).toHaveBeenCalledTimes(1);
    expect(closeSidebar).not.toHaveBeenCalled();
  });

  it("makes duplicate sync and unregister operations safe", () => {
    const coordinator = createOverlayCoordinator();
    const close = vi.fn();

    coordinator.sync("sidebar", true, { kind: "non-modal", close });
    coordinator.sync("sidebar", true, { kind: "non-modal", close });
    expect(coordinator.getActiveCount()).toBe(1);

    coordinator.sync("sidebar", false);
    coordinator.sync("sidebar", false);
    expect(coordinator.getActiveCount()).toBe(0);
    expect(coordinator.closeTopOverlay()).toBe(false);
  });
});
