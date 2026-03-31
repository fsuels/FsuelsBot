import { describe, expect, it } from "vitest";
import {
  createSelectNavigationState,
  getSelectNavigationFocusedIndex,
  moveSelectNavigation,
  setSelectNavigationFocus,
  syncSelectNavigation,
} from "./select-navigation.js";

describe("select-navigation", () => {
  const itemIds = ["one", "two", "three", "four", "five", "six", "seven"];

  it("wraps around on previous/next when enabled", () => {
    let state = createSelectNavigationState({
      itemIds,
      maxVisible: 3,
      wraparound: true,
    });

    state = moveSelectNavigation(state, { itemIds, direction: "previous" });
    expect(state.focusedItemId).toBe("seven");

    state = moveSelectNavigation(state, { itemIds, direction: "next" });
    expect(state.focusedItemId).toBe("one");
  });

  it("supports page navigation and minimally scrolls the viewport", () => {
    let state = createSelectNavigationState({
      itemIds,
      maxVisible: 3,
      wraparound: true,
    });

    state = moveSelectNavigation(state, { itemIds, direction: "pageDown" });
    expect(state.focusedItemId).toBe("four");
    expect(state.visibleFromIndex).toBe(1);
    expect(state.visibleToIndex).toBe(3);

    state = moveSelectNavigation(state, { itemIds, direction: "pageUp" });
    expect(state.focusedItemId).toBe("one");
    expect(state.visibleFromIndex).toBe(0);
    expect(state.visibleToIndex).toBe(2);
  });

  it("preserves focus and viewport when async refresh keeps the focused item visible", () => {
    let state = createSelectNavigationState({
      itemIds,
      maxVisible: 3,
      wraparound: true,
    });

    state = setSelectNavigationFocus(state, {
      itemIds,
      itemId: "three",
    });
    state = moveSelectNavigation(state, { itemIds, direction: "next" });
    expect(state.focusedItemId).toBe("four");
    expect(state.visibleFromIndex).toBe(1);
    expect(state.visibleToIndex).toBe(3);

    state = syncSelectNavigation(state, {
      itemIds: ["zero", "two", "three", "four", "five"],
    });

    expect(state.focusedItemId).toBe("four");
    expect(state.visibleFromIndex).toBe(1);
    expect(state.visibleToIndex).toBe(3);
  });

  it("falls back to the first valid item after async refresh without losing focus", () => {
    let state = createSelectNavigationState({
      itemIds,
      maxVisible: 3,
      wraparound: true,
    });

    state = setSelectNavigationFocus(state, {
      itemIds,
      itemId: "five",
    });

    state = syncSelectNavigation(state, {
      itemIds: ["alpha", "beta", "gamma"],
    });

    expect(state.focusedItemId).toBe("alpha");
    expect(getSelectNavigationFocusedIndex(state, ["alpha", "beta", "gamma"])).toBe(0);
  });

  it("keeps focus valid across rapid successive refreshes", () => {
    let state = createSelectNavigationState({
      itemIds,
      maxVisible: 4,
      wraparound: true,
    });

    state = setSelectNavigationFocus(state, {
      itemIds,
      itemId: "six",
    });

    state = syncSelectNavigation(state, {
      itemIds: ["two", "three", "six", "eight"],
    });
    state = syncSelectNavigation(state, {
      itemIds: ["eight", "nine"],
    });

    expect(state.focusedItemId).toBe("eight");
    expect(getSelectNavigationFocusedIndex(state, ["eight", "nine"])).toBe(0);
  });
});
