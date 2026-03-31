import { type SelectItem, type SelectListTheme, truncateToWidth } from "@mariozechner/pi-tui";
import { visibleWidth } from "../../terminal/ansi.js";

function normalizeToSingleLine(text: string): string {
  return text.replace(/[\r\n]+/g, " ").trim();
}

export function renderSelectListItemLine(params: {
  item: SelectItem;
  isSelected: boolean;
  width: number;
  theme: SelectListTheme;
  highlight?: (text: string) => string;
}): string {
  const highlight = params.highlight ?? ((text: string) => text);
  const prefix = params.isSelected ? "→ " : "  ";
  const prefixWidth = prefix.length;
  const displayValue = params.item.label || params.item.value;
  const description = params.item.description
    ? normalizeToSingleLine(params.item.description)
    : undefined;

  if (description && params.width > 40) {
    const maxValueWidth = Math.min(30, params.width - prefixWidth - 4);
    const truncatedValue = truncateToWidth(displayValue, maxValueWidth, "");
    const valueText = highlight(truncatedValue);
    const spacingWidth = Math.max(1, 32 - visibleWidth(valueText));
    const spacing = " ".repeat(spacingWidth);
    const descriptionStart = prefixWidth + visibleWidth(valueText) + spacing.length;
    const remainingWidth = params.width - descriptionStart - 2;
    if (remainingWidth > 10) {
      const truncatedDescription = truncateToWidth(description, remainingWidth, "");
      const highlightedDescription = highlight(truncatedDescription);
      const descriptionText = params.isSelected
        ? highlightedDescription
        : params.theme.description(highlightedDescription);
      const line = `${prefix}${valueText}${spacing}${descriptionText}`;
      return params.isSelected ? params.theme.selectedText(line) : line;
    }
  }

  const maxWidth = params.width - prefixWidth - 2;
  const truncatedValue = truncateToWidth(displayValue, maxWidth, "");
  const valueText = highlight(truncatedValue);
  const line = `${prefix}${valueText}`;
  return params.isSelected ? params.theme.selectedText(line) : line;
}
