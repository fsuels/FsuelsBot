import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenClawApp } from "./app.ts";

// oxlint-disable-next-line typescript/unbound-method
const originalConnect = OpenClawApp.prototype.connect;

function mountApp(pathname: string) {
  window.history.replaceState({}, "", pathname);
  const app = document.createElement("openclaw-app") as OpenClawApp;
  document.body.append(app);
  return app;
}

beforeEach(() => {
  OpenClawApp.prototype.connect = () => {
    // no-op: avoid real gateway WS connections in browser tests
  };
  window.__OPENCLAW_CONTROL_UI_BASE_PATH__ = undefined;
  localStorage.clear();
  document.body.innerHTML = "";
});

afterEach(() => {
  OpenClawApp.prototype.connect = originalConnect;
  window.__OPENCLAW_CONTROL_UI_BASE_PATH__ = undefined;
  localStorage.clear();
  document.body.innerHTML = "";
});

describe("overlay coordination", () => {
  it("closes the sidebar before aborting an active run on Escape", async () => {
    const app = mountApp("/chat");
    await app.updateComplete;

    app.connected = true;
    app.chatRunId = "run-1";
    app.handleOpenSidebar("tool output");
    await app.updateComplete;

    const abortSpy = vi.spyOn(app, "handleAbortChat").mockResolvedValue();

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await app.updateComplete;

    expect(app.sidebarOpen).toBe(false);
    expect(abortSpy).not.toHaveBeenCalled();

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(abortSpy).toHaveBeenCalledTimes(1);
  });

  it("treats modal overlays as focus-blocking but leaves non-modal sidebar compose enabled", async () => {
    const app = mountApp("/chat");
    await app.updateComplete;

    app.connected = true;
    await app.updateComplete;

    const textarea = app.querySelector<HTMLTextAreaElement>("textarea");
    expect(textarea).not.toBeNull();
    expect(textarea?.disabled).toBe(false);

    app.handleOpenSidebar("tool output");
    await app.updateComplete;

    expect(app.hasModalOverlay()).toBe(false);
    expect(textarea?.disabled).toBe(false);

    app.pendingGatewayUrl = "wss://example.test/gateway";
    app.syncOverlays();
    await app.updateComplete;

    expect(app.hasModalOverlay()).toBe(true);
    expect(textarea?.disabled).toBe(true);
  });

  it("uses Escape to deny the active exec approval before aborting chat", async () => {
    const app = mountApp("/chat");
    await app.updateComplete;

    app.connected = true;
    app.chatRunId = "run-1";
    app.execApprovalQueue = [
      {
        id: "approval-1",
        request: { command: "rm -rf /tmp/test" },
        expiresAtMs: Date.now() + 60_000,
      },
    ] as never;
    app.syncOverlays();
    await app.updateComplete;

    const decisionSpy = vi.spyOn(app, "handleExecApprovalDecision").mockResolvedValue();
    const abortSpy = vi.spyOn(app, "handleAbortChat").mockResolvedValue();

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(decisionSpy).toHaveBeenCalledWith("deny");
    expect(abortSpy).not.toHaveBeenCalled();
  });
});
