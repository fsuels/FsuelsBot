import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
  localStorage.clear();
  document.body.innerHTML = "";
});

afterEach(() => {
  OpenClawApp.prototype.connect = originalConnect;
  localStorage.clear();
  document.body.innerHTML = "";
});

describe("control UI overlay rendering", () => {
  it("renders only the newest modal when multiple modals are active", async () => {
    const app = mountApp("/chat");
    await app.updateComplete;

    app.execApprovalQueue = [
      {
        id: "approval-1",
        request: { command: "rm -rf /tmp/demo" },
        createdAtMs: 1_000,
        expiresAtMs: Date.now() + 60_000,
      },
    ];
    app.pendingGatewayUrl = "wss://example.com/gateway";

    await app.updateComplete;
    await app.updateComplete;

    const overlays = Array.from(app.querySelectorAll<HTMLElement>(".exec-approval-overlay"));
    expect(overlays).toHaveLength(1);
    expect(overlays[0]?.dataset.overlayId).toBe("gateway-url-confirmation");
    expect(app.textContent).toContain("Change Gateway URL");
    expect(app.textContent).not.toContain("Exec approval needed");
  });

  it("keeps the active modal rendered even when a newer non-modal overlay is open", async () => {
    const app = mountApp("/chat");
    await app.updateComplete;

    app.execApprovalQueue = [
      {
        id: "approval-1",
        request: { command: "rm -rf /tmp/demo" },
        createdAtMs: 1_000,
        expiresAtMs: Date.now() + 60_000,
      },
    ];
    await app.updateComplete;

    app.handleOpenSidebar("tool output");
    await app.updateComplete;
    await app.updateComplete;

    expect(app.getActiveOverlayIds()).toEqual(["chat-sidebar", "exec-approval"]);
    expect(app.getModalOverlayIds().at(-1)).toBe("exec-approval");
    expect(app.querySelector('[data-overlay-id="exec-approval"]')).not.toBeNull();
    expect(app.textContent).toContain("Exec approval needed");
  });
});
