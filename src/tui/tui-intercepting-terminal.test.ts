import type { Terminal } from "@mariozechner/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { InterceptingTerminal } from "./tui-intercepting-terminal.js";

describe("InterceptingTerminal", () => {
  it("swallows intercepted input before it reaches the TUI", () => {
    let inputHandler: ((data: string) => void) | undefined;
    const delegate: Terminal = {
      start(onInput) {
        inputHandler = onInput;
      },
      stop: vi.fn(),
      drainInput: vi.fn(async () => {}),
      write: vi.fn(),
      get columns() {
        return 80;
      },
      get rows() {
        return 24;
      },
      get kittyProtocolActive() {
        return false;
      },
      moveBy: vi.fn(),
      hideCursor: vi.fn(),
      showCursor: vi.fn(),
      clearLine: vi.fn(),
      clearFromCursor: vi.fn(),
      clearScreen: vi.fn(),
      setTitle: vi.fn(),
    };

    const terminal = new InterceptingTerminal(delegate);
    const onInput = vi.fn();
    terminal.setInputInterceptor((data) => data === "\u0003");
    terminal.start(onInput, vi.fn());

    inputHandler?.("\u0003");
    inputHandler?.("hello");

    expect(onInput).toHaveBeenCalledTimes(1);
    expect(onInput).toHaveBeenCalledWith("hello");
  });
});
