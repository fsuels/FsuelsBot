import { describe, expect, it } from "vitest";
import { visibleWidth } from "./ansi.js";
import { wrapNoteMessage } from "./note.js";

describe("wrapNoteMessage", () => {
  it("wraps bullet lines by display width without splitting wide graphemes", () => {
    const message = wrapNoteMessage("- 你好你好你好你好", { maxWidth: 8, columns: 40 });
    const lines = message.split("\n");

    for (const line of lines) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(8);
    }
  });

  it("expands tabs before wrapping", () => {
    const message = wrapNoteMessage("label\tvalue", { maxWidth: 12, columns: 40 });
    expect(message).not.toContain("\t");
    for (const line of message.split("\n")) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(12);
    }
  });
});
