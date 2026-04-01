import { describe, expect, it } from "vitest";
import {
  buildTerminalResetSequence,
  disableBracketedPaste,
  disableFocusEvents,
  disableMouseTracking,
  disableSgrMouseMode,
  disableKittyKeyboardProtocol,
  formatOsc52Clipboard,
  formatOsc8Hyperlink,
  showCursor,
  sgrReset,
  wrapTmuxPassthrough,
} from "./codec.js";

describe("terminal codec", () => {
  it("formats OSC 8 hyperlinks without hand-built escape strings in callers", () => {
    expect(formatOsc8Hyperlink("docs", "https://docs.openclaw.ai")).toBe(
      "\u001b]8;;https://docs.openclaw.ai\u0007docs\u001b]8;;\u0007",
    );
  });

  it("formats OSC 52 clipboard payloads as base64", () => {
    expect(formatOsc52Clipboard("hello")).toBe("\u001b]52;c;aGVsbG8=\u0007");
  });

  it("wraps passthrough sequences for tmux by doubling embedded ESC bytes", () => {
    const wrapped = wrapTmuxPassthrough("\u001b]52;c;aGVsbG8=\u0007");
    expect(wrapped).toBe("\u001bPtmux;\u001b\u001b]52;c;aGVsbG8=\u0007\u001b\\");
  });

  it("builds the shared terminal reset sequence from codec primitives", () => {
    expect(buildTerminalResetSequence()).toBe(
      [
        sgrReset(),
        showCursor(),
        disableMouseTracking(1000),
        disableMouseTracking(1002),
        disableMouseTracking(1003),
        disableFocusEvents(),
        disableSgrMouseMode(),
        disableBracketedPaste(),
        disableKittyKeyboardProtocol(),
      ].join(""),
    );
  });
});
