import { Input, Key, matchesKey, type Component, type SelectListTheme } from "@mariozechner/pi-tui";
import chalk from "chalk";
import {
  expandTabs,
  graphemeDisplayWidth,
  splitDisplayGraphemes,
  truncateToDisplayWidth,
  visibleWidth,
} from "../../terminal/ansi.js";
import { type FilterableSelectItem } from "./filterable-select-list.js";
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

export type SessionPreviewItem = {
  role: "user" | "assistant" | "tool" | "system" | "other";
  text: string;
};

export type SessionPreviewEntry = {
  key: string;
  status: "ok" | "empty" | "missing" | "error";
  items: SessionPreviewItem[];
};

export type SessionPreviewErrorKind = "network" | "auth" | "api" | "other";

export interface SessionPreviewSelectListTheme extends SelectListTheme {
  filterLabel: (text: string) => string;
  previewLabel: (text: string) => string;
  previewMeta: (text: string) => string;
  previewRole: (text: string) => string;
  previewText: (text: string) => string;
  hint: (text: string) => string;
  loading: (text: string) => string;
  error: (text: string) => string;
}

type PreparedItem = FilterableSelectItem & { searchTextLower: string };

type PreviewErrorState = {
  key: string;
  kind: SessionPreviewErrorKind;
  message: string;
  guidance: string;
};

function buildWrappedLines(text: string, width: number, maxLines: number): string[] {
  const normalizedWidth = Math.max(8, width);
  const normalizedLines = Math.max(1, maxLines);
  const normalizedText = expandTabs(text).replace(/\s+/g, " ").trim();
  const words = normalizedText.split(" ").filter(Boolean);
  if (words.length === 0) {
    return [""];
  }

  const splitLongWord = (word: string): string[] => {
    const parts: string[] = [];
    let current = "";
    let currentWidth = 0;

    for (const grapheme of splitDisplayGraphemes(word)) {
      const nextWidth = graphemeDisplayWidth(grapheme);
      if (current && currentWidth + nextWidth > normalizedWidth) {
        parts.push(current);
        current = grapheme;
        currentWidth = nextWidth;
        continue;
      }
      current += grapheme;
      currentWidth += nextWidth;
    }

    if (current || parts.length === 0) {
      parts.push(current);
    }
    return parts;
  };

  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (!current) {
      if (visibleWidth(word) > normalizedWidth) {
        lines.push(...splitLongWord(word));
        if (lines.length >= normalizedLines) {
          break;
        }
        current = "";
        continue;
      }
      current = word;
      continue;
    }
    const candidate = `${current} ${word}`;
    if (visibleWidth(candidate) <= normalizedWidth) {
      current = candidate;
      continue;
    }
    lines.push(current);
    if (visibleWidth(word) > normalizedWidth) {
      lines.push(...splitLongWord(word));
      current = "";
    } else {
      current = word;
    }
    if (lines.length >= normalizedLines) {
      break;
    }
  }
  if (lines.length < normalizedLines && current) {
    lines.push(current);
  }
  if (lines.length === 0) {
    lines.push("");
  }

  return lines.slice(0, normalizedLines).map((line, index, all) => {
    const isLast = index === all.length - 1;
    const truncated = truncateToDisplayWidth(line, normalizedWidth, { ellipsis: "" });
    if (!isLast) {
      return truncated;
    }
    const needsEllipsis =
      visibleWidth(normalizedText) > normalizedWidth &&
      (all.length === normalizedLines || visibleWidth(truncated) >= normalizedWidth);
    if (!needsEllipsis) {
      return truncated;
    }
    return `${truncateToDisplayWidth(truncated, Math.max(1, normalizedWidth - 1), {
      ellipsis: "",
    })}…`;
  });
}

function padAnsi(text: string, width: number): string {
  const padding = Math.max(0, width - visibleWidth(text));
  return `${text}${" ".repeat(padding)}`;
}

export function classifySessionPreviewError(error: unknown): {
  kind: SessionPreviewErrorKind;
  message: string;
  guidance: string;
} {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();

  if (
    normalized.includes("unauthorized") ||
    normalized.includes("forbidden") ||
    normalized.includes("invalid token") ||
    normalized.includes("auth")
  ) {
    return {
      kind: "auth",
      message,
      guidance: "Gateway auth failed. Reconnect or refresh credentials, then press Ctrl+R.",
    };
  }

  if (
    normalized.includes("gateway not connected") ||
    normalized.includes("closed") ||
    normalized.includes("timeout") ||
    normalized.includes("timed out") ||
    normalized.includes("socket") ||
    normalized.includes("econn") ||
    normalized.includes("network")
  ) {
    return {
      kind: "network",
      message,
      guidance: "Gateway connectivity failed. Reconnect, then press Ctrl+R to retry.",
    };
  }

  if (
    normalized.includes("invalid request") ||
    normalized.includes("unknown method") ||
    normalized.includes("protocol") ||
    normalized.includes("bad request")
  ) {
    return {
      kind: "api",
      message,
      guidance: "The gateway rejected the preview request. Check compatibility, then press Ctrl+R.",
    };
  }

  return {
    kind: "other",
    message,
    guidance: "Preview failed. Press Ctrl+R to retry.",
  };
}

export class SessionPreviewSelectList implements Component {
  private input: Input;
  private allItems: PreparedItem[];
  private filteredItems: PreparedItem[];
  private maxVisible: number;
  private theme: SessionPreviewSelectListTheme;
  private filterText = "";
  private navigation: SelectNavigationState;
  private previewGeneration = 0;
  private preview: SessionPreviewEntry | null = null;
  private previewLoadingKey: string | null = null;
  private previewError: PreviewErrorState | null = null;
  private readonly loadPreview: (key: string) => Promise<SessionPreviewEntry>;
  private readonly requestRender: () => void;

  onSelect?: (item: FilterableSelectItem) => void;
  onCancel?: () => void;

  constructor(params: {
    items: FilterableSelectItem[];
    maxVisible: number;
    theme: SessionPreviewSelectListTheme;
    loadPreview: (key: string) => Promise<SessionPreviewEntry>;
    requestRender: () => void;
  }) {
    this.allItems = prepareSearchItems(params.items);
    this.filteredItems = this.allItems;
    this.maxVisible = params.maxVisible;
    this.theme = params.theme;
    this.loadPreview = params.loadPreview;
    this.requestRender = params.requestRender;
    this.input = new Input();
    this.navigation = createSelectNavigationState({
      itemIds: this.getFilteredItemIds(),
      maxVisible: this.maxVisible,
      wraparound: true,
    });
    this.refreshPreviewForSelection();
  }

  private getFilteredItemIds(): string[] {
    return this.filteredItems.map((item) => item.value);
  }

  private getSelectedItem(): PreparedItem | null {
    const focusedIndex = getSelectNavigationFocusedIndex(
      this.navigation,
      this.getFilteredItemIds(),
    );
    return this.filteredItems[focusedIndex] ?? null;
  }

  private applyFilter(options: { preserveFocus?: boolean } = {}): void {
    const queryLower = this.filterText.toLowerCase().trim();
    const previousFocusedItemId = options.preserveFocus ? this.navigation.focusedItemId : null;
    const previousSelectedKey = this.getSelectedItem()?.value ?? null;
    this.filteredItems = queryLower ? fuzzyFilterLower(this.allItems, queryLower) : this.allItems;
    this.navigation = syncSelectNavigation(this.navigation, {
      itemIds: this.getFilteredItemIds(),
      focusedItemId: previousFocusedItemId,
      maxVisible: this.maxVisible,
      wraparound: true,
    });
    const nextSelectedKey = this.getSelectedItem()?.value ?? null;
    if (previousSelectedKey !== nextSelectedKey) {
      this.refreshPreviewForSelection();
    }
  }

  private refreshPreviewForSelection(options: { force?: boolean } = {}): void {
    const selected = this.getSelectedItem();
    if (!selected) {
      this.previewLoadingKey = null;
      this.previewError = null;
      this.requestRender();
      return;
    }
    if (
      !options.force &&
      this.preview?.key === selected.value &&
      this.previewError?.key !== selected.value
    ) {
      return;
    }

    const generation = ++this.previewGeneration;
    this.previewLoadingKey = selected.value;
    if (this.previewError?.key === selected.value) {
      this.previewError = null;
    }
    this.requestRender();

    void this.loadPreview(selected.value)
      .then((preview) => {
        if (generation !== this.previewGeneration) {
          return;
        }
        this.previewLoadingKey = null;
        this.previewError = null;
        this.preview = preview;
        this.requestRender();
      })
      .catch((error) => {
        if (generation !== this.previewGeneration) {
          return;
        }
        this.previewLoadingKey = null;
        this.previewError = {
          key: selected.value,
          ...classifySessionPreviewError(error),
        };
        this.requestRender();
      });
  }

  setItems(items: FilterableSelectItem[]): void {
    this.allItems = prepareSearchItems(items);
    this.applyFilter({ preserveFocus: true });
  }

  invalidate(): void {
    this.input.invalidate();
  }

  private renderList(width: number): string[] {
    const lines: string[] = [];
    const filterLabel = this.theme.filterLabel("Filter: ");
    const inputWidth = Math.max(1, width - visibleWidth(filterLabel));
    const inputLines = this.input.render(inputWidth);
    lines.push(`${filterLabel}${inputLines[0] ?? ""}`);
    lines.push(chalk.dim("─".repeat(Math.max(0, width))));

    if (this.filteredItems.length === 0) {
      lines.push(this.theme.noMatch("  No matching sessions"));
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
      lines.push(this.theme.scrollInfo(`  ${focusedIndex + 1} of ${this.filteredItems.length}`));
    }

    return lines;
  }

  private renderPreview(width: number): string[] {
    const selected = this.getSelectedItem();
    const selectedKey = selected?.value ?? null;
    const lines = [
      this.theme.previewLabel("Preview"),
      this.theme.previewMeta("Inspect before resuming"),
    ];

    if (!selectedKey) {
      lines.push(this.theme.noMatch("No session selected."));
      return lines;
    }

    if (this.previewLoadingKey === selectedKey) {
      lines.push(this.theme.loading("Loading preview for the current selection…"));
      if (this.preview && this.preview.key !== selectedKey) {
        lines.push(
          this.theme.previewMeta("Showing the previous preview until the new one arrives."),
        );
      }
    }

    if (this.previewError?.key === selectedKey) {
      lines.push(
        this.theme.error(
          `${this.previewError.kind.toUpperCase()}: ${truncateToDisplayWidth(this.previewError.message, Math.max(20, width - 2), { ellipsis: "" })}`,
        ),
      );
      lines.push(this.theme.hint(this.previewError.guidance));
    }

    const activePreview = this.preview;
    if (!activePreview) {
      lines.push(this.theme.previewMeta("Waiting for preview data…"));
      lines.push(
        this.theme.hint("Enter resumes the focused session. Ctrl+R retries preview loading."),
      );
      return lines;
    }

    if (activePreview.key !== selectedKey) {
      lines.push(this.theme.previewMeta(`Preview shown for ${activePreview.key}`));
    }

    if (activePreview.status === "missing") {
      lines.push(this.theme.previewMeta("Transcript missing for this session."));
    } else if (activePreview.status === "empty") {
      lines.push(this.theme.previewMeta("Transcript exists, but there is nothing to preview yet."));
    } else if (activePreview.status === "error") {
      lines.push(this.theme.error("Transcript preview could not be read from disk."));
      lines.push(this.theme.hint("Press Ctrl+R to retry."));
    } else if (activePreview.items.length === 0) {
      lines.push(this.theme.previewMeta("No transcript items available."));
    } else {
      const previewWidth = Math.max(12, width - 4);
      for (const item of activePreview.items.slice(0, 6)) {
        const role = this.theme.previewRole(`[${item.role}]`);
        const wrapped = buildWrappedLines(item.text, previewWidth, 2);
        if (wrapped.length === 0) {
          lines.push(`${role} ${this.theme.previewText("")}`);
          continue;
        }
        lines.push(`${role} ${this.theme.previewText(wrapped[0] ?? "")}`);
        for (const continuation of wrapped.slice(1)) {
          lines.push(`    ${this.theme.previewText(continuation)}`);
        }
      }
    }

    lines.push("");
    lines.push(this.theme.hint("Enter resume  Ctrl+R retry preview  Esc cancel"));
    return lines.map((line) => truncateToDisplayWidth(line, Math.max(1, width), { ellipsis: "" }));
  }

  render(width: number): string[] {
    const normalizedWidth = Math.max(40, width);
    if (normalizedWidth >= 110) {
      const listWidth = Math.max(36, Math.min(46, Math.floor(normalizedWidth * 0.42)));
      const previewWidth = Math.max(28, normalizedWidth - listWidth - 3);
      const listLines = this.renderList(listWidth);
      const previewLines = this.renderPreview(previewWidth);
      const height = Math.max(listLines.length, previewLines.length);
      const lines: string[] = [];
      for (let index = 0; index < height; index++) {
        const left = padAnsi(listLines[index] ?? "", listWidth);
        const right = previewLines[index] ?? "";
        lines.push(`${left}${chalk.dim(" │ ")}${right}`);
      }
      return lines;
    }

    return [
      ...this.renderList(normalizedWidth),
      "",
      chalk.dim("─".repeat(Math.max(0, normalizedWidth))),
      ...this.renderPreview(normalizedWidth),
    ];
  }

  handleInput(keyData: string): void {
    if (matchesKey(keyData, Key.ctrl("r"))) {
      this.refreshPreviewForSelection({ force: true });
      return;
    }

    const action = routeSelectInput(keyData);
    const previousSelectedKey = this.getSelectedItem()?.value ?? null;

    if (action === "focusPrevious") {
      this.navigation = moveSelectNavigation(this.navigation, {
        itemIds: this.getFilteredItemIds(),
        direction: "previous",
      });
    } else if (action === "focusNext") {
      this.navigation = moveSelectNavigation(this.navigation, {
        itemIds: this.getFilteredItemIds(),
        direction: "next",
      });
    } else if (action === "pageUp") {
      this.navigation = moveSelectNavigation(this.navigation, {
        itemIds: this.getFilteredItemIds(),
        direction: "pageUp",
      });
    } else if (action === "pageDown") {
      this.navigation = moveSelectNavigation(this.navigation, {
        itemIds: this.getFilteredItemIds(),
        direction: "pageDown",
      });
    } else if (action === "confirm") {
      const selected = this.getSelectedItem();
      if (selected) {
        this.onSelect?.(selected);
      }
      return;
    } else if (action === "cancel") {
      if (this.filterText) {
        this.filterText = "";
        this.input.setValue("");
        this.applyFilter();
      } else {
        this.onCancel?.();
      }
      return;
    } else {
      const previousValue = this.input.getValue();
      this.input.handleInput(keyData);
      const nextValue = this.input.getValue();
      if (nextValue !== previousValue) {
        this.filterText = nextValue;
        this.applyFilter();
        return;
      }
    }

    const nextSelectedKey = this.getSelectedItem()?.value ?? null;
    if (previousSelectedKey !== nextSelectedKey) {
      this.refreshPreviewForSelection();
    }
  }
}
