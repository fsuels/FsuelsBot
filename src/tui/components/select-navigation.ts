export interface SelectNavigationState {
  focusedItemId: string | null;
  visibleFromIndex: number;
  visibleToIndex: number;
  maxVisible: number;
  wraparound: boolean;
}

export type SelectNavigationDirection = "next" | "previous" | "pageDown" | "pageUp";

type SelectNavigationOptions = {
  itemIds: string[];
  focusedItemId?: string | null;
  maxVisible?: number;
  wraparound?: boolean;
};

function normalizeMaxVisible(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.max(1, Math.floor(value ?? 1));
}

function getWindowSize(itemCount: number, maxVisible: number): number {
  if (itemCount <= 0) {
    return 0;
  }
  return Math.min(itemCount, normalizeMaxVisible(maxVisible));
}

function clampVisibleFrom(visibleFromIndex: number, itemCount: number, maxVisible: number): number {
  if (itemCount <= 0) {
    return 0;
  }
  const windowSize = getWindowSize(itemCount, maxVisible);
  const raw = Number.isFinite(visibleFromIndex) ? Math.floor(visibleFromIndex) : 0;
  return Math.max(0, Math.min(raw, itemCount - windowSize));
}

function deriveVisibleToIndex(
  visibleFromIndex: number,
  itemCount: number,
  maxVisible: number,
): number {
  if (itemCount <= 0) {
    return -1;
  }
  const windowSize = getWindowSize(itemCount, maxVisible);
  return Math.min(itemCount - 1, visibleFromIndex + windowSize - 1);
}

function buildViewport(visibleFromIndex: number, itemCount: number, maxVisible: number) {
  const nextVisibleFromIndex = clampVisibleFrom(visibleFromIndex, itemCount, maxVisible);
  return {
    visibleFromIndex: nextVisibleFromIndex,
    visibleToIndex: deriveVisibleToIndex(nextVisibleFromIndex, itemCount, maxVisible),
  };
}

function resolveFocusedItemId(
  itemIds: string[],
  preferredFocusedItemId: string | null | undefined,
): string | null {
  if (itemIds.length === 0) {
    return null;
  }
  if (preferredFocusedItemId && itemIds.includes(preferredFocusedItemId)) {
    return preferredFocusedItemId;
  }
  return itemIds[0] ?? null;
}

function ensureFocusedItemIsVisible(
  visibleFromIndex: number,
  focusedIndex: number,
  itemCount: number,
  maxVisible: number,
) {
  const viewport = buildViewport(visibleFromIndex, itemCount, maxVisible);
  if (focusedIndex >= viewport.visibleFromIndex && focusedIndex <= viewport.visibleToIndex) {
    return viewport;
  }
  if (focusedIndex < viewport.visibleFromIndex) {
    return buildViewport(focusedIndex, itemCount, maxVisible);
  }
  const windowSize = getWindowSize(itemCount, maxVisible);
  return buildViewport(focusedIndex - windowSize + 1, itemCount, maxVisible);
}

function syncState(
  state: SelectNavigationState,
  options: SelectNavigationOptions,
): SelectNavigationState {
  const maxVisible = normalizeMaxVisible(options.maxVisible ?? state.maxVisible);
  const wraparound = options.wraparound ?? state.wraparound;
  const itemIds = options.itemIds;

  if (itemIds.length === 0) {
    return {
      focusedItemId: null,
      visibleFromIndex: 0,
      visibleToIndex: -1,
      maxVisible,
      wraparound,
    };
  }

  const focusedItemId = resolveFocusedItemId(
    itemIds,
    options.focusedItemId === undefined ? state.focusedItemId : options.focusedItemId,
  );
  const focusedIndex = focusedItemId ? itemIds.indexOf(focusedItemId) : -1;
  const viewport = ensureFocusedItemIsVisible(
    state.visibleFromIndex,
    Math.max(0, focusedIndex),
    itemIds.length,
    maxVisible,
  );

  return {
    focusedItemId,
    visibleFromIndex: viewport.visibleFromIndex,
    visibleToIndex: viewport.visibleToIndex,
    maxVisible,
    wraparound,
  };
}

export function createSelectNavigationState(
  options: SelectNavigationOptions,
): SelectNavigationState {
  return syncState(
    {
      focusedItemId: null,
      visibleFromIndex: 0,
      visibleToIndex: -1,
      maxVisible: normalizeMaxVisible(options.maxVisible),
      wraparound: options.wraparound ?? true,
    },
    options,
  );
}

export function syncSelectNavigation(
  state: SelectNavigationState,
  options: SelectNavigationOptions,
): SelectNavigationState {
  return syncState(state, options);
}

export function setSelectNavigationFocus(
  state: SelectNavigationState,
  options: SelectNavigationOptions & { itemId: string | null },
): SelectNavigationState {
  return syncState(state, {
    itemIds: options.itemIds,
    focusedItemId: options.itemId,
    maxVisible: options.maxVisible,
    wraparound: options.wraparound,
  });
}

export function moveSelectNavigation(
  state: SelectNavigationState,
  options: { itemIds: string[]; direction: SelectNavigationDirection },
): SelectNavigationState {
  const synced = syncState(state, { itemIds: options.itemIds });
  const itemIds = options.itemIds;
  if (itemIds.length === 0 || !synced.focusedItemId) {
    return synced;
  }

  const currentIndex = itemIds.indexOf(synced.focusedItemId);
  if (currentIndex === -1) {
    return synced;
  }

  const pageSize = Math.max(1, synced.visibleToIndex - synced.visibleFromIndex + 1);
  let nextIndex = currentIndex;

  if (options.direction === "next") {
    if (currentIndex === itemIds.length - 1) {
      nextIndex = synced.wraparound ? 0 : currentIndex;
    } else {
      nextIndex = currentIndex + 1;
    }
  }

  if (options.direction === "previous") {
    if (currentIndex === 0) {
      nextIndex = synced.wraparound ? itemIds.length - 1 : currentIndex;
    } else {
      nextIndex = currentIndex - 1;
    }
  }

  if (options.direction === "pageDown") {
    nextIndex = Math.min(itemIds.length - 1, currentIndex + pageSize);
  }

  if (options.direction === "pageUp") {
    nextIndex = Math.max(0, currentIndex - pageSize);
  }

  return setSelectNavigationFocus(synced, {
    itemIds,
    itemId: itemIds[nextIndex] ?? null,
  });
}

export function getSelectNavigationFocusedIndex(
  state: SelectNavigationState,
  itemIds: string[],
): number {
  const synced = syncState(state, { itemIds });
  if (!synced.focusedItemId) {
    return -1;
  }
  return itemIds.indexOf(synced.focusedItemId);
}
