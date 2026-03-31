import type { Component, TUI } from "@mariozechner/pi-tui";

type OverlayHost = Pick<TUI, "showOverlay" | "hideOverlay" | "hasOverlay" | "setFocus">;

export function handleOverlayEscape(params: {
  hasActiveOverlay: () => boolean;
  closeOverlay: () => void;
  abortActive: () => Promise<void> | void;
  requestRender?: () => void;
}) {
  if (params.hasActiveOverlay()) {
    params.closeOverlay();
    params.requestRender?.();
    return "overlay";
  }
  void params.abortActive();
  return "abort";
}

export function createOverlayHandlers(host: OverlayHost, fallbackFocus: Component) {
  const openOverlay = (component: Component) => {
    host.showOverlay(component);
    host.setFocus(component);
  };

  const closeOverlay = () => {
    if (host.hasOverlay()) {
      host.hideOverlay();
      host.setFocus(fallbackFocus);
      return true;
    }
    host.setFocus(fallbackFocus);
    return false;
  };

  const hasActiveOverlay = () => host.hasOverlay();

  return { openOverlay, closeOverlay, hasActiveOverlay };
}
