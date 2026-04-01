import { describe, expect, it } from "vitest";
import { formatClipboardOsc52, resolveClipboardPlan } from "./clipboard.js";

describe("terminal clipboard planning", () => {
  it("prefers native clipboard access locally and still keeps OSC 52 available", () => {
    expect(resolveClipboardPlan({ env: {}, isTTY: true })).toEqual({
      methods: ["native", "osc52"],
      isRemoteSession: false,
      isTmuxSession: false,
      isTTY: true,
    });
  });

  it("avoids remote native clipboards and falls back through tmux and OSC 52", () => {
    expect(
      resolveClipboardPlan({
        env: {
          SSH_CONNECTION: "client host 22 22",
          TMUX: "/tmp/tmux-1000/default,123,0",
        },
        isTTY: true,
      }),
    ).toEqual({
      methods: ["tmux-buffer", "osc52"],
      isRemoteSession: true,
      isTmuxSession: true,
      isTTY: true,
    });
  });

  it("wraps OSC 52 through tmux passthrough when needed", () => {
    expect(formatClipboardOsc52("hello", { env: { TMUX: "1" } })).toBe(
      "\u001bPtmux;\u001b\u001b]52;c;aGVsbG8=\u0007\u001b\\",
    );
  });
});
