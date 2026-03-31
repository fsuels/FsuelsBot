import type { Component } from "@mariozechner/pi-tui";
import { Input, type SelectItem, type SelectListTheme } from "@mariozechner/pi-tui";
import chalk from "chalk";
import { fuzzyFilterLower, prepareSearchItems } from "./fuzzy-filter.js";
import { routeSelectInput } from "./select-input-routing.js";
import { renderSelectListItemLine } from "./select-list-render.js";
import {
  createSelectNavigationState,
  getSelectNavigationFocusedIndex,
  moveSelectNavigation,
  syncSelectNavigation,
  type SelectNavigationState,
} from "./select-navigation.js";

export interface FilterableSelectItem extends SelectItem {
  /** Additional searchable fields beyond label */
  searchText?: string;
  /** Pre-computed lowercase search text (label + description + searchText) for filtering */
  searchTextLower?: string;
}

export interface FilterableSelectListTheme extends SelectListTheme {
  filterLabel: (text: string) => string;
}

/**
 * Combines text input filtering with a select list.
 * User types to filter, navigation keys move the focused item, Enter selects, Escape cancels.
 */
export class FilterableSelectList implements Component {
  private input: Input;
  private allItems: FilterableSelectItem[];
  private filteredItems: FilterableSelectItem[];
  private maxVisible: number;
  private theme: FilterableSelectListTheme;
  private filterText = "";
  private navigation: SelectNavigationState;

  onSelect?: (item: SelectItem) => void;
  onCancel?: () => void;

  constructor(items: FilterableSelectItem[], maxVisible: number, theme: FilterableSelectListTheme) {
    this.allItems = prepareSearchItems(items);
    this.maxVisible = maxVisible;
    this.theme = theme;
    this.input = new Input();
    this.filteredItems = this.allItems;
    this.navigation = createSelectNavigationState({
      itemIds: this.getFilteredItemIds(),
      maxVisible,
      wraparound: true,
    });
  }

  private applyFilter(options: { preserveFocus?: boolean } = {}): void {
    const queryLower = this.filterText.toLowerCase();
    const currentFocusedItemId = options.preserveFocus ? this.navigation.focusedItemId : null;
    if (!queryLower.trim()) {
      this.filteredItems = this.allItems;
    } else {
      this.filteredItems = fuzzyFilterLower(this.allItems, queryLower);
    }
    this.navigation = syncSelectNavigation(this.navigation, {
      itemIds: this.getFilteredItemIds(),
      focusedItemId: currentFocusedItemId,
      maxVisible: this.maxVisible,
      wraparound: true,
    });
  }

  private getFilteredItemIds(): string[] {
    return this.filteredItems.map((item) => item.value);
  }

  setItems(items: FilterableSelectItem[]): void {
    this.allItems = prepareSearchItems(items);
    this.applyFilter({ preserveFocus: true });
  }

  invalidate(): void {
    this.input.invalidate();
  }

  render(width: number): string[] {
    const lines: string[] = [];

    // Filter input row
    const filterLabel = this.theme.filterLabel("Filter: ");
    const inputLines = this.input.render(width - 8);
    const inputText = inputLines[0] ?? "";
    lines.push(filterLabel + inputText);

    // Separator
    lines.push(chalk.dim("─".repeat(Math.max(0, width))));

    if (this.filteredItems.length === 0) {
      lines.push(this.theme.noMatch("  No matching commands"));
      return lines;
    }

    const navigation = syncSelectNavigation(this.navigation, {
      itemIds: this.getFilteredItemIds(),
      maxVisible: this.maxVisible,
      wraparound: true,
    });
    this.navigation = navigation;
    const focusedIndex = getSelectNavigationFocusedIndex(navigation, this.getFilteredItemIds());

    for (let i = navigation.visibleFromIndex; i <= navigation.visibleToIndex; i++) {
      const item = this.filteredItems[i];
      if (!item) {
        continue;
      }
      lines.push(
        renderSelectListItemLine({
          item,
          isSelected: i === focusedIndex,
          width,
          theme: this.theme,
        }),
      );
    }

    if (this.filteredItems.length > this.maxVisible) {
      lines.push(this.theme.scrollInfo(`  ${focusedIndex + 1}/${this.filteredItems.length}`));
    }

    return lines;
  }

  handleInput(keyData: string): void {
    const action = routeSelectInput(keyData);

    if (action === "focusPrevious") {
      this.navigation = moveSelectNavigation(this.navigation, {
        itemIds: this.getFilteredItemIds(),
        direction: "previous",
      });
      return;
    }

    if (action === "focusNext") {
      this.navigation = moveSelectNavigation(this.navigation, {
        itemIds: this.getFilteredItemIds(),
        direction: "next",
      });
      return;
    }

    if (action === "pageUp") {
      this.navigation = moveSelectNavigation(this.navigation, {
        itemIds: this.getFilteredItemIds(),
        direction: "pageUp",
      });
      return;
    }

    if (action === "pageDown") {
      this.navigation = moveSelectNavigation(this.navigation, {
        itemIds: this.getFilteredItemIds(),
        direction: "pageDown",
      });
      return;
    }

    // Enter selects
    if (action === "confirm") {
      const focusedIndex = getSelectNavigationFocusedIndex(
        this.navigation,
        this.getFilteredItemIds(),
      );
      const selected = this.filteredItems[focusedIndex] ?? null;
      if (selected) {
        this.onSelect?.(selected);
      }
      return;
    }

    // Escape: clear filter or cancel
    if (action === "cancel") {
      if (this.filterText) {
        this.filterText = "";
        this.input.setValue("");
        this.applyFilter();
      } else {
        this.onCancel?.();
      }
      return;
    }

    // All other input goes to filter
    const prevValue = this.input.getValue();
    this.input.handleInput(keyData);
    const newValue = this.input.getValue();

    if (newValue !== prevValue) {
      this.filterText = newValue;
      this.applyFilter();
    }
  }

  getSelectedItem(): SelectItem | null {
    const focusedIndex = getSelectNavigationFocusedIndex(
      this.navigation,
      this.getFilteredItemIds(),
    );
    return this.filteredItems[focusedIndex] ?? null;
  }

  getFilterText(): string {
    return this.filterText;
  }
}
