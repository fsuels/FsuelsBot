import { describe, expect, it, vi } from "vitest";
import { createOverlayCoordinator, handleAppEscapeKey, syncAppOverlays } from "./app-overlays.ts";

function createHost(overrides: Partial<Parameters<typeof syncAppOverlays>[0]> = {}) {
  return {
    sidebarOpen: false,
    execApprovalQueue: [],
    pendingGatewayUrl: null,
    overlayCoordinator: createOverlayCoordinator(),
    telemetry: {
      noteOverlayCount: vi.fn(),
    },
    handleCloseSidebar: vi.fn(),
    handleExecApprovalDecision: vi.fn(async () => undefined),
    handleGatewayUrlCancel: vi.fn(),
    connected: true,
    chatRunId: "run-1",
    handleAbortChat: vi.fn(async () => undefined),
    ...overrides,
  };
}

function createEscapeEvent() {
  return {
    key: "Escape",
    defaultPrevented: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    preventDefault: vi.fn(),
  } as KeyboardEvent;
}

describe("app overlays", () => {
  it("syncs modal and non-modal overlays into the coordinator", () => {
    const host = createHost({
      sidebarOpen: true,
      execApprovalQueue: [{ id: "approval-1" }],
      pendingGatewayUrl: "wss://example.com/gateway",
    });

    syncAppOverlays(host);

    expect(host.overlayCoordinator.getSnapshot()).toEqual({
      activeIds: ["chat-sidebar", "exec-approval", "gateway-url-confirmation"],
      modalIds: ["exec-approval", "gateway-url-confirmation"],
      topOverlayId: "gateway-url-confirmation",
    });
    expect(host.telemetry.noteOverlayCount).toHaveBeenCalledWith(3);
  });

  it("lets Escape dismiss the newest modal before a newer non-modal overlay", () => {
    const host = createHost({
      sidebarOpen: true,
      execApprovalQueue: [{ id: "approval-1" }],
    });
    syncAppOverlays(host);

    const event = createEscapeEvent();
    const handled = handleAppEscapeKey(host, event);

    expect(handled).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(host.handleExecApprovalDecision).toHaveBeenCalledWith("deny");
    expect(host.handleCloseSidebar).not.toHaveBeenCalled();
    expect(host.handleAbortChat).not.toHaveBeenCalled();
  });

  it("aborts the chat only when no overlays remain", () => {
    const host = createHost();

    const event = createEscapeEvent();
    const handled = handleAppEscapeKey(host, event);

    expect(handled).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(host.handleAbortChat).toHaveBeenCalledTimes(1);
  });
});
