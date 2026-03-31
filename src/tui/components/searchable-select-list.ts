import {
  type Component,
  Input,
  isKeyRelease,
  type SelectItem,
  type SelectListTheme,
} from "@mariozechner/pi-tui";
import { visibleWidth } from "../../terminal/ansi.js";
import { findWordBoundaryIndex, fuzzyFilterLower, prepareSearchItems } from "./fuzzy-filter.js";
import { routeSelectInput } from "./select-input-routing.js";
import { renderSelectListItemLine } from "./select-list-render.js";
import {
  createSelectNavigationState,
  getSelectNavigationFocusedIndex,
  moveSelectNavigation,
  setSelectNavigationFocus,
  syncSelectNavigation,
  type SelectNavigationState,
} from "./select-navigation.js";

export interface SearchableSelectListTheme extends SelectListTheme {
  searchPrompt: (text: string) => string;
  searchInput: (text: string) => string;
  matchHighlight: (text: string) => string;
}

/**
 * A select list with a search input at the top for fuzzy filtering.
 */
export class SearchableSelectList implements Component {
  private items: SelectItem[];
  private filteredItems: SelectItem[];
  private maxVisible: number;
  private theme: SearchableSelectListTheme;
  private searchInput: Input;
  private regexCache = new Map<string, RegExp>();
  private navigation: SelectNavigationState;

  onSelect?: (item: SelectItem) => void;
  onCancel?: () => void;
  onSelectionChange?: (item: SelectItem) => void;

  constructor(items: SelectItem[], maxVisible: number, theme: SearchableSelectListTheme) {
    this.items = items;
    this.filteredItems = items;
    this.maxVisible = maxVisible;
    this.theme = theme;
    this.searchInput = new Input();
    this.navigation = createSelectNavigationState({
      itemIds: this.getFilteredItemIds(),
      maxVisible,
      wraparound: true,
    });
  }

  private getCachedRegex(pattern: string): RegExp {
    let regex = this.regexCache.get(pattern);
    if (!regex) {
      regex = new RegExp(this.escapeRegex(pattern), "gi");
      this.regexCache.set(pattern, regex);
    }
    return regex;
  }

  private updateFilter(options: { preserveFocus?: boolean } = {}) {
    const query = this.searchInput.getValue().trim();
    const currentFocusedItemId = options.preserveFocus ? this.navigation.focusedItemId : null;

    if (!query) {
      this.filteredItems = this.items;
    } else {
      this.filteredItems = this.smartFilter(query);
    }

    this.updateNavigation(
      syncSelectNavigation(this.navigation, {
        itemIds: this.getFilteredItemIds(),
        focusedItemId: currentFocusedItemId,
        maxVisible: this.maxVisible,
        wraparound: true,
      }),
    );
  }

  /**
   * Smart filtering that prioritizes:
   * 1. Exact substring match in label (highest priority)
   * 2. Word-boundary prefix match in label
   * 3. Exact substring in description
   * 4. Fuzzy match (lowest priority)
   */
  private smartFilter(query: string): SelectItem[] {
    const q = query.toLowerCase();
    type ScoredItem = { item: SelectItem; tier: number; score: number };
    const scoredItems: ScoredItem[] = [];
    const fuzzyCandidates: SelectItem[] = [];

    for (const item of this.items) {
      const label = item.label.toLowerCase();
      const desc = (item.description ?? "").toLowerCase();

      // Tier 1: Exact substring in label
      const labelIndex = label.indexOf(q);
      if (labelIndex !== -1) {
        scoredItems.push({ item, tier: 0, score: labelIndex });
        continue;
      }
      // Tier 2: Word-boundary prefix in label
      const wordBoundaryIndex = findWordBoundaryIndex(label, q);
      if (wordBoundaryIndex !== null) {
        scoredItems.push({ item, tier: 1, score: wordBoundaryIndex });
        continue;
      }
      // Tier 3: Exact substring in description
      const descIndex = desc.indexOf(q);
      if (descIndex !== -1) {
        scoredItems.push({ item, tier: 2, score: descIndex });
        continue;
      }
      // Tier 4: Fuzzy match (score 300+)
      fuzzyCandidates.push(item);
    }

    scoredItems.sort(this.compareByScore);

    const preparedCandidates = prepareSearchItems(fuzzyCandidates);
    const fuzzyMatches = fuzzyFilterLower(preparedCandidates, q);

    return [...scoredItems.map((s) => s.item), ...fuzzyMatches];
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  private compareByScore = (
    a: { item: SelectItem; tier: number; score: number },
    b: { item: SelectItem; tier: number; score: number },
  ) => {
    if (a.tier !== b.tier) {
      return a.tier - b.tier;
    }
    if (a.score !== b.score) {
      return a.score - b.score;
    }
    return this.getItemLabel(a.item).localeCompare(this.getItemLabel(b.item));
  };

  private getItemLabel(item: SelectItem): string {
    return item.label || item.value;
  }

  private highlightMatch(text: string, query: string): string {
    const tokens = query
      .trim()
      .split(/\s+/)
      .map((token) => token.toLowerCase())
      .filter((token) => token.length > 0);
    if (tokens.length === 0) {
      return text;
    }

    const uniqueTokens = Array.from(new Set(tokens)).toSorted((a, b) => b.length - a.length);
    let result = text;
    for (const token of uniqueTokens) {
      const regex = this.getCachedRegex(token);
      result = result.replace(regex, (match) => this.theme.matchHighlight(match));
    }
    return result;
  }

  private getFilteredItemIds(): string[] {
    return this.filteredItems.map((item) => item.value);
  }

  private updateNavigation(next: SelectNavigationState) {
    const previousFocusedItemId = this.navigation.focusedItemId;
    this.navigation = next;
    if (previousFocusedItemId !== this.navigation.focusedItemId) {
      this.notifySelectionChange();
    }
  }

  setSelectedIndex(index: number) {
    const item = this.filteredItems[Math.max(0, Math.min(index, this.filteredItems.length - 1))];
    this.updateNavigation(
      setSelectNavigationFocus(this.navigation, {
        itemIds: this.getFilteredItemIds(),
        itemId: item?.value ?? null,
      }),
    );
  }

  setItems(items: SelectItem[]) {
    this.items = items;
    this.updateFilter({ preserveFocus: true });
  }

  invalidate() {
    this.searchInput.invalidate();
  }

  render(width: number): string[] {
    const lines: string[] = [];

    // Search input line
    const promptText = "search: ";
    const prompt = this.theme.searchPrompt(promptText);
    const inputWidth = Math.max(1, width - visibleWidth(prompt));
    const inputLines = this.searchInput.render(inputWidth);
    const inputText = inputLines[0] ?? "";
    lines.push(`${prompt}${this.theme.searchInput(inputText)}`);
    lines.push(""); // Spacer

    const query = this.searchInput.getValue().trim();

    // If no items match filter, show message
    if (this.filteredItems.length === 0) {
      lines.push(this.theme.noMatch("  No matches"));
      return lines;
    }

    const navigation = syncSelectNavigation(this.navigation, {
      itemIds: this.getFilteredItemIds(),
      maxVisible: this.maxVisible,
      wraparound: true,
    });
    this.navigation = navigation;
    const focusedIndex = getSelectNavigationFocusedIndex(navigation, this.getFilteredItemIds());

    // Render visible items
    for (let i = navigation.visibleFromIndex; i <= navigation.visibleToIndex; i++) {
      const item = this.filteredItems[i];
      if (!item) {
        continue;
      }
      const isSelected = i === focusedIndex;
      lines.push(this.renderItemLine(item, isSelected, width, query));
    }

    // Show scroll indicator if needed
    if (this.filteredItems.length > this.maxVisible) {
      const scrollInfo = `${focusedIndex + 1}/${this.filteredItems.length}`;
      lines.push(this.theme.scrollInfo(`  ${scrollInfo}`));
    }

    return lines;
  }

  private renderItemLine(
    item: SelectItem,
    isSelected: boolean,
    width: number,
    query: string,
  ): string {
    return renderSelectListItemLine({
      item,
      isSelected,
      width,
      theme: this.theme,
      highlight: (text) => this.highlightMatch(text, query),
    });
  }

  handleInput(keyData: string): void {
    if (isKeyRelease(keyData)) {
      return;
    }

    const action = routeSelectInput(keyData);
    if (action === "focusPrevious") {
      this.updateNavigation(
        moveSelectNavigation(this.navigation, {
          itemIds: this.getFilteredItemIds(),
          direction: "previous",
        }),
      );
      return;
    }

    if (action === "focusNext") {
      this.updateNavigation(
        moveSelectNavigation(this.navigation, {
          itemIds: this.getFilteredItemIds(),
          direction: "next",
        }),
      );
      return;
    }

    if (action === "pageUp") {
      this.updateNavigation(
        moveSelectNavigation(this.navigation, {
          itemIds: this.getFilteredItemIds(),
          direction: "pageUp",
        }),
      );
      return;
    }

    if (action === "pageDown") {
      this.updateNavigation(
        moveSelectNavigation(this.navigation, {
          itemIds: this.getFilteredItemIds(),
          direction: "pageDown",
        }),
      );
      return;
    }

    if (action === "confirm") {
      const focusedIndex = getSelectNavigationFocusedIndex(
        this.navigation,
        this.getFilteredItemIds(),
      );
      const item = this.filteredItems[focusedIndex];
      if (item && this.onSelect) {
        this.onSelect(item);
      }
      return;
    }

    if (action === "cancel") {
      if (this.onCancel) {
        this.onCancel();
      }
      return;
    }

    // Pass other keys to search input
    const prevValue = this.searchInput.getValue();
    this.searchInput.handleInput(keyData);
    const newValue = this.searchInput.getValue();

    if (prevValue !== newValue) {
      this.updateFilter();
    }
  }

  private notifySelectionChange() {
    const focusedIndex = getSelectNavigationFocusedIndex(
      this.navigation,
      this.getFilteredItemIds(),
    );
    const item = this.filteredItems[focusedIndex];
    if (item && this.onSelectionChange) {
      this.onSelectionChange(item);
    }
  }

  getSelectedItem(): SelectItem | null {
    const focusedIndex = getSelectNavigationFocusedIndex(
      this.navigation,
      this.getFilteredItemIds(),
    );
    return this.filteredItems[focusedIndex] ?? null;
  }
}
