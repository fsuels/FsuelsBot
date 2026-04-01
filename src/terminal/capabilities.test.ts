import { describe, expect, it } from "vitest";
import {
  getTerminalCapabilities,
  resolveTerminalCapabilities,
  supportsTerminalHyperlinks,
} from "./capabilities.js";

describe("terminal capabilities", () => {
  it("keeps advanced terminal features off for non-tty streams", () => {
    const capabilities = getTerminalCapabilities({
      env: { TERM_PROGRAM: "iTerm.app" },
      stream: { isTTY: false },
    });

    expect(capabilities.supportsHyperlinks).toBe(false);
    expect(capabilities.supportsOscProgress).toBe(false);
  });

  it("detects common hyperlink-capable terminals conservatively", () => {
    const capabilities = getTerminalCapabilities({
      env: { TERM_PROGRAM: "vscode" },
      stream: { isTTY: true },
    });

    expect(capabilities.isXtermJs).toBe(true);
    expect(capabilities.supportsHyperlinks).toBe(true);
  });

  it("lets explicit overrides force hyperlink support on or off", () => {
    expect(
      supportsTerminalHyperlinks({
        env: { TERM: "dumb", FORCE_HYPERLINK: "1" },
        stream: { isTTY: true },
      }),
    ).toBe(true);

    expect(
      supportsTerminalHyperlinks({
        env: { TERM_PROGRAM: "iTerm.app", NO_HYPERLINKS: "1" },
        stream: { isTTY: true },
      }),
    ).toBe(false);
  });

  it("treats TERM=dumb as unsupported without an explicit override", () => {
    const capabilities = getTerminalCapabilities({
      env: { TERM: "dumb", TERM_PROGRAM: "iTerm.app" },
      stream: { isTTY: true },
    });

    expect(capabilities.supportsHyperlinks).toBe(false);
  });

  it("boosts VS Code xterm truecolor from 256-color to truecolor", () => {
    const caps = resolveTerminalCapabilities({
      env: {
        TERM_PROGRAM: "vscode",
        TERM: "xterm-256color",
      },
      isTTY: true,
    });

    expect(caps.colorLevel).toBe(3);
    expect(caps.shouldBoostTruecolorForVscodeXterm).toBe(true);
  });

  it("clamps tmux truecolor unless explicitly overridden", () => {
    const caps = resolveTerminalCapabilities({
      env: {
        TMUX: "/tmp/tmux-1000/default,123,0",
        COLORTERM: "truecolor",
      },
      isTTY: true,
    });

    expect(caps.colorLevel).toBe(2);
    expect(caps.truecolorLevel).toBe(2);
    expect(caps.shouldClampTruecolorForTmux).toBe(true);
  });

  it("respects NO_COLOR and FORCE_COLOR=0", () => {
    expect(
      resolveTerminalCapabilities({
        env: {
          NO_COLOR: "1",
          TERM_PROGRAM: "vscode",
          TERM: "xterm-256color",
        },
        isTTY: true,
      }).colorLevel,
    ).toBe(0);

    expect(
      resolveTerminalCapabilities({
        env: {
          FORCE_COLOR: "0",
          TERM_PROGRAM: "vscode",
          TERM: "xterm-256color",
        },
        isTTY: true,
      }).colorLevel,
    ).toBe(0);
  });

  it("falls back for legacy Windows consoles without modern terminal markers", () => {
    const caps = resolveTerminalCapabilities({
      env: {},
      platform: "win32",
      isTTY: true,
    });

    expect(caps.supportsScrollbackErase).toBe(false);
    expect(caps.supportsHyperlinks).toBe(false);
  });

  it("marks Windows Terminal and VS Code sessions as needing software bidi", () => {
    expect(
      resolveTerminalCapabilities({
        env: { WT_SESSION: "abc" },
        platform: "win32",
        isTTY: true,
      }).needsSoftwareBidi,
    ).toBe(true);

    expect(
      resolveTerminalCapabilities({
        env: { TERM_PROGRAM: "vscode" },
        platform: "linux",
        isTTY: true,
      }).needsSoftwareBidi,
    ).toBe(true);
  });
});
