import { type SelectItem, SelectList, type SettingItem, SettingsList } from "@mariozechner/pi-tui";
import {
  filterableSelectListTheme,
  sessionPreviewSelectListTheme,
  searchableSelectListTheme,
  selectListTheme,
  settingsListTheme,
} from "../theme/theme.js";
import { FilterableSelectList, type FilterableSelectItem } from "./filterable-select-list.js";
import { SearchableSelectList } from "./searchable-select-list.js";
import {
  SessionPreviewSelectList,
  type SessionPreviewEntry,
} from "./session-preview-select-list.js";

export function createSelectList(items: SelectItem[], maxVisible = 7) {
  return new SelectList(items, maxVisible, selectListTheme);
}

export function createSearchableSelectList(items: SelectItem[], maxVisible = 7) {
  return new SearchableSelectList(items, maxVisible, searchableSelectListTheme);
}

export function createFilterableSelectList(items: FilterableSelectItem[], maxVisible = 7) {
  return new FilterableSelectList(items, maxVisible, filterableSelectListTheme);
}

export function createSessionPreviewSelectList(params: {
  items: FilterableSelectItem[];
  maxVisible?: number;
  loadPreview: (key: string) => Promise<SessionPreviewEntry>;
  requestRender: () => void;
}) {
  return new SessionPreviewSelectList({
    items: params.items,
    maxVisible: params.maxVisible ?? 7,
    theme: sessionPreviewSelectListTheme,
    loadPreview: params.loadPreview,
    requestRender: params.requestRender,
  });
}

export function createSettingsList(
  items: SettingItem[],
  onChange: (id: string, value: string) => void,
  onCancel: () => void,
  maxVisible = 7,
) {
  return new SettingsList(items, maxVisible, settingsListTheme, onChange, onCancel);
}
