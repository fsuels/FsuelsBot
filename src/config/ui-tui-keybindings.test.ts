import { describe, expect, it } from "vitest";
import { validateConfigObject } from "./config.js";

describe("ui.tui keybindings", () => {
  it("accepts valid shortcut overrides, editor bindings, and null unbinds", () => {
    const res = validateConfigObject({
      ui: {
        tui: {
          shortcuts: {
            abortRun: null,
            openModelPicker: "Ctrl+L",
          },
          editor: {
            submit: ["Enter", "ctrl+j"],
            selectCancel: null,
          },
        },
      },
    });

    expect(res.ok).toBe(true);
  });

  it("rejects invalid shortcut key ids", () => {
    const res = validateConfigObject({
      ui: {
        tui: {
          shortcuts: {
            openModelPicker: "banana",
          },
        },
      },
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.issues).toContainEqual(
        expect.objectContaining({
          path: "ui.tui.shortcuts.openModelPicker",
        }),
      );
    }
  });

  it("rejects invalid editor key ids", () => {
    const res = validateConfigObject({
      ui: {
        tui: {
          editor: {
            submit: ["enter", "ctrl+meta+j"],
          },
        },
      },
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.issues).toContainEqual(
        expect.objectContaining({
          path: "ui.tui.editor.submit",
        }),
      );
    }
  });
});
