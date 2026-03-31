export type OverlayKind = "modal" | "non-modal";

export type OverlayRegistration = {
  id: string;
  kind: OverlayKind;
  close: () => void;
};

export type OverlaySnapshot = {
  activeIds: string[];
  modalIds: string[];
  topOverlayId: string | null;
};

type ActiveOverlay = OverlayRegistration & {
  order: number;
};

/**
 * Centralizes overlay ordering so Escape closes the newest overlay before it
 * falls through to more destructive actions like aborting a running task.
 */
export function createOverlayCoordinator() {
  const overlays = new Map<string, ActiveOverlay>();
  let nextOrder = 0;

  const getOrdered = () =>
    Array.from(overlays.values()).sort((left, right) => left.order - right.order);

  const getTopOverlay = (kind?: OverlayKind) => {
    let top: ActiveOverlay | null = null;
    for (const overlay of overlays.values()) {
      if (kind && overlay.kind !== kind) {
        continue;
      }
      if (!top || overlay.order > top.order) {
        top = overlay;
      }
    }
    return top;
  };

  return {
    activate(registration: OverlayRegistration) {
      overlays.set(registration.id, {
        ...registration,
        order: ++nextOrder,
      });
    },

    deactivate(id: string) {
      overlays.delete(id);
    },

    sync(id: string, enabled: boolean, registration?: Omit<OverlayRegistration, "id">) {
      if (!enabled) {
        overlays.delete(id);
        return;
      }
      if (!registration) {
        throw new Error(`Overlay ${id} must provide registration details when enabled.`);
      }
      overlays.set(id, {
        id,
        kind: registration.kind,
        close: registration.close,
        order: ++nextOrder,
      });
    },

    closeTopOverlay(): boolean {
      const top = getTopOverlay();
      if (!top) {
        return false;
      }
      top.close();
      return true;
    },

    closeTopModalOverlay(): boolean {
      const top = getTopOverlay("modal");
      if (!top) {
        return false;
      }
      top.close();
      return true;
    },

    isOverlayActive() {
      return overlays.size > 0;
    },

    isModalOverlayActive() {
      for (const overlay of overlays.values()) {
        if (overlay.kind === "modal") {
          return true;
        }
      }
      return false;
    },

    getActiveCount() {
      return overlays.size;
    },

    getSnapshot(): OverlaySnapshot {
      const ordered = getOrdered();
      return {
        activeIds: ordered.map((overlay) => overlay.id),
        modalIds: ordered
          .filter((overlay) => overlay.kind === "modal")
          .map((overlay) => overlay.id),
        topOverlayId: ordered.at(-1)?.id ?? null,
      };
    },
  };
}
