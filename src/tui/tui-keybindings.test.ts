import { type EditorAction } from "@mariozechner/pi-tui";
import { describe, expect, it } from "vitest";
import {
  createEditorKeybindingsManager,
  isValidTuiKeybindingValue,
  normalizeTuiKeyId,
  TuiShortcutManager,
} from "./tui-keybindings.js";

describe("tui-keybindings", () => {
  it("normalizes key ids to canonical pi-tui form", () => {
    expect(normalizeTuiKeyId("Ctrl+L")).toBe("ctrl+l");
    expect(normalizeTuiKeyId("shift+RETURN")).toBe("shift+return");
    expect(normalizeTuiKeyId("ctrl+pageup")).toBe("ctrl+pageUp");
    expect(normalizeTuiKeyId("ctrl++")).toBe("ctrl++");
  });

  it("rejects invalid key ids", () => {
    expect(normalizeTuiKeyId("ctrl+ctrl+l")).toBeNull();
    expect(normalizeTuiKeyId("meta+l")).toBeNull();
    expect(normalizeTuiKeyId("banana")).toBeNull();
  });

  it("accepts validated keybinding values and null unbinds", () => {
    expect(isValidTuiKeybindingValue("Ctrl+P")).toBe(true);
    expect(isValidTuiKeybindingValue(["enter", "ctrl+j"])).toBe(true);
    expect(isValidTuiKeybindingValue(null)).toBe(true);
    expect(isValidTuiKeybindingValue([])).toBe(false);
  });

  it("lets tui shortcuts override or unbind defaults", () => {
    const manager = new TuiShortcutManager({
      abortRun: null,
      openModelPicker: "Ctrl+X",
    });

    expect(manager.getKeys("abortRun")).toEqual([]);
    expect(manager.getKeys("openModelPicker")).toEqual(["ctrl+x"]);
  });

  it("lets editor bindings override or unbind defaults", () => {
    const manager = createEditorKeybindingsManager({
      submit: null,
      deleteToLineStart: "Ctrl+X",
    } as Partial<Record<EditorAction, string | null>>);

    expect(manager.getKeys("submit")).toEqual([]);
    expect(manager.getKeys("deleteToLineStart")).toEqual(["ctrl+x"]);
  });
});
