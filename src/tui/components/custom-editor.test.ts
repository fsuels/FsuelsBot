import { EditorKeybindingsManager, setEditorKeybindings } from "@mariozechner/pi-tui";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditorKeybindingsManager, TuiShortcutManager } from "../tui-keybindings.js";
import { CustomEditor } from "./custom-editor.js";

function makeEditor() {
  return new CustomEditor(
    { requestRender: vi.fn() } as never,
    { borderColor: (text: string) => text } as never,
  );
}

describe("CustomEditor", () => {
  afterEach(() => {
    setEditorKeybindings(new EditorKeybindingsManager());
  });

  it("dispatches default tui shortcuts through the action handlers", () => {
    const editor = makeEditor();
    const openModelPicker = vi.fn();

    editor.setShortcutHandler("openModelPicker", openModelPicker);
    editor.handleInput("\x0c");

    expect(openModelPicker).toHaveBeenCalledTimes(1);
  });

  it("supports custom shortcut overrides and null unbinds", () => {
    const editor = makeEditor();
    const shortcutManager = new TuiShortcutManager({
      abortRun: null,
      openModelPicker: "ctrl+x",
    });
    const abortRun = vi.fn();
    const openModelPicker = vi.fn();

    editor.setShortcutManager(shortcutManager);
    editor.setShortcutHandler("abortRun", abortRun);
    editor.setShortcutHandler("openModelPicker", openModelPicker);

    editor.handleInput("\x1b");
    editor.handleInput("\x0c");
    editor.handleInput("\x18");

    expect(abortRun).not.toHaveBeenCalled();
    expect(openModelPicker).toHaveBeenCalledTimes(1);
  });

  it("checks tui shortcuts before editor keybindings", () => {
    setEditorKeybindings(
      createEditorKeybindingsManager({
        deleteToLineStart: "ctrl+o",
      }),
    );

    const editor = makeEditor();
    const toggleToolOutput = vi.fn();

    editor.setText("hello");
    editor.setShortcutHandler("toggleToolOutput", toggleToolOutput);
    editor.handleInput("\x0f");

    expect(toggleToolOutput).toHaveBeenCalledTimes(1);
    expect(editor.getText()).toBe("hello");
  });
});
