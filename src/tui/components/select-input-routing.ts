import { getEditorKeybindings, matchesKey } from "@mariozechner/pi-tui";

export type SelectInputAction =
  | "focusPrevious"
  | "focusNext"
  | "pageUp"
  | "pageDown"
  | "confirm"
  | "cancel"
  | "input";

export function routeSelectInput(keyData: string): SelectInputAction {
  const kb = getEditorKeybindings();

  if (kb.matches(keyData, "selectUp") || matchesKey(keyData, "ctrl+p")) {
    return "focusPrevious";
  }

  if (kb.matches(keyData, "selectDown") || matchesKey(keyData, "ctrl+n")) {
    return "focusNext";
  }

  if (kb.matches(keyData, "selectPageUp")) {
    return "pageUp";
  }

  if (kb.matches(keyData, "selectPageDown")) {
    return "pageDown";
  }

  if (kb.matches(keyData, "selectConfirm")) {
    return "confirm";
  }

  if (kb.matches(keyData, "selectCancel")) {
    return "cancel";
  }

  return "input";
}
