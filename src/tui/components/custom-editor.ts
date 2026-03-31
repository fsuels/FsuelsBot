import { Editor, Key, matchesKey } from "@mariozechner/pi-tui";
import { TuiShortcutManager, type TuiShortcutAction } from "../tui-keybindings.js";

export class CustomEditor extends Editor {
  onShiftTab?: () => void;
  onAltEnter?: () => void;
  private shortcutManager = new TuiShortcutManager();
  private shortcutHandlers = new Map<TuiShortcutAction, () => void>();

  setShortcutManager(manager: TuiShortcutManager): void {
    this.shortcutManager = manager;
  }

  setShortcutHandler(action: TuiShortcutAction, handler?: () => void): void {
    if (!handler) {
      this.shortcutHandlers.delete(action);
      return;
    }
    this.shortcutHandlers.set(action, handler);
  }

  private triggerShortcut(action: TuiShortcutAction): boolean {
    const handler = this.shortcutHandlers.get(action);
    if (!handler) {
      return false;
    }
    handler();
    return true;
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.alt("enter")) && this.onAltEnter) {
      this.onAltEnter();
      return;
    }
    if (
      this.shortcutManager.matches(data, "openModelPicker") &&
      this.triggerShortcut("openModelPicker")
    ) {
      return;
    }
    if (
      this.shortcutManager.matches(data, "toggleToolOutput") &&
      this.triggerShortcut("toggleToolOutput")
    ) {
      return;
    }
    if (
      this.shortcutManager.matches(data, "openSessionPicker") &&
      this.triggerShortcut("openSessionPicker")
    ) {
      return;
    }
    if (
      this.shortcutManager.matches(data, "openAgentPicker") &&
      this.triggerShortcut("openAgentPicker")
    ) {
      return;
    }
    if (
      this.shortcutManager.matches(data, "toggleThinking") &&
      this.triggerShortcut("toggleThinking")
    ) {
      return;
    }
    if (matchesKey(data, Key.shift("tab")) && this.onShiftTab) {
      this.onShiftTab();
      return;
    }
    if (
      this.shortcutManager.matches(data, "abortRun") &&
      !this.isShowingAutocomplete() &&
      this.triggerShortcut("abortRun")
    ) {
      return;
    }
    if (
      this.shortcutManager.matches(data, "clearInputOrExit") &&
      this.triggerShortcut("clearInputOrExit")
    ) {
      return;
    }
    if (this.shortcutManager.matches(data, "exit")) {
      if (this.getText().length === 0 && this.triggerShortcut("exit")) {
        return;
      }
      return;
    }
    super.handleInput(data);
  }
}
