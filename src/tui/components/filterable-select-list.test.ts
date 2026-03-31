import { describe, expect, it } from "vitest";
import {
  FilterableSelectList,
  type FilterableSelectItem,
  type FilterableSelectListTheme,
} from "./filterable-select-list.js";

const mockTheme: FilterableSelectListTheme = {
  selectedPrefix: (text) => `[${text}]`,
  selectedText: (text) => `**${text}**`,
  description: (text) => `(${text})`,
  scrollInfo: (text) => `~${text}~`,
  noMatch: (text) => `!${text}!`,
  filterLabel: (text) => text,
};

const testItems: FilterableSelectItem[] = [
  { value: "alpha", label: "alpha" },
  { value: "beta", label: "beta" },
  { value: "betamax", label: "betamax" },
  { value: "gamma", label: "gamma" },
  { value: "delta", label: "delta" },
];

describe("FilterableSelectList", () => {
  it("moves focus to the top filtered result when the query changes", () => {
    const list = new FilterableSelectList(testItems, 3, mockTheme);

    list.handleInput("\x1b[B");
    list.handleInput("\x1b[B");
    expect(list.getSelectedItem()?.value).toBe("betamax");

    for (const ch of "beta") {
      list.handleInput(ch);
    }

    expect(list.getSelectedItem()?.value).toBe("beta");
  });

  it("lets printable keys type into the filter instead of hijacking list navigation", () => {
    const list = new FilterableSelectList(testItems, 3, mockTheme);

    list.handleInput("j");
    expect(list.getFilterText()).toBe("j");
    expect(list.getSelectedItem()).toBeNull();
  });

  it("supports page down navigation", () => {
    const list = new FilterableSelectList(testItems, 2, mockTheme);

    list.handleInput("\x1b[6~");
    expect(list.getSelectedItem()?.value).toBe("betamax");
  });

  it("falls back to the first item when refreshed items drop the focused value", () => {
    const list = new FilterableSelectList(testItems, 3, mockTheme);

    list.handleInput("\x1b[B");
    list.handleInput("\x1b[B");
    expect(list.getSelectedItem()?.value).toBe("betamax");

    list.setItems([
      { value: "epsilon", label: "epsilon" },
      { value: "zeta", label: "zeta" },
    ]);

    expect(list.getSelectedItem()?.value).toBe("epsilon");
  });
});
