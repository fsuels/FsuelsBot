import type { UiTelemetry } from "./types/internal.ts";
import { createOverlayCoordinator } from "../../../src/shared/overlay-coordinator.ts";

export { createOverlayCoordinator };

type OverlayHost = {
  sidebarOpen: boolean;
  execApprovalQueue: Array<unknown>;
  pendingGatewayUrl: string | null;
  overlayCoordinator: ReturnType<typeof createOverlayCoordinator>;
  telemetry: Pick<UiTelemetry, "noteOverlayCount">;
  handleCloseSidebar: () => void;
  handleExecApprovalDecision: (decision: "allow-once" | "allow-always" | "deny") => Promise<void>;
  handleGatewayUrlCancel: () => void;
};

type EscapeHost = OverlayHost & {
  connected: boolean;
  chatRunId: string | null;
  handleAbortChat: () => Promise<void>;
};

export function syncAppOverlays(host: OverlayHost) {
  host.overlayCoordinator.sync("chat-sidebar", host.sidebarOpen, {
    kind: "non-modal",
    close: () => host.handleCloseSidebar(),
  });
  host.overlayCoordinator.sync("exec-approval", host.execApprovalQueue.length > 0, {
    kind: "modal",
    close: () => {
      void host.handleExecApprovalDecision("deny");
    },
  });
  host.overlayCoordinator.sync("gateway-url-confirmation", Boolean(host.pendingGatewayUrl), {
    kind: "modal",
    close: () => host.handleGatewayUrlCancel(),
  });
  host.telemetry.noteOverlayCount(host.overlayCoordinator.getActiveCount());
}

export function handleAppEscapeKey(host: EscapeHost, event: KeyboardEvent) {
  if (
    event.key !== "Escape" ||
    event.defaultPrevented ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey
  ) {
    return false;
  }
  if (host.overlayCoordinator.closeTopModalOverlay()) {
    event.preventDefault();
    return true;
  }
  if (host.overlayCoordinator.closeTopOverlay()) {
    event.preventDefault();
    return true;
  }
  if (host.connected && host.chatRunId) {
    event.preventDefault();
    void host.handleAbortChat();
    return true;
  }
  return false;
}
