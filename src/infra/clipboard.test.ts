import { describe, expect, it, vi } from "vitest";
import { copyToClipboard } from "./clipboard.js";

describe("copyToClipboard", () => {
  it("uses native clipboard utilities first for local sessions", async () => {
    const runCommand = vi
      .fn()
      .mockResolvedValueOnce({ code: 0, killed: false, stdout: "", stderr: "", signal: null });
    const stdout = {
      isTTY: true,
      write: vi.fn(),
    };

    await expect(copyToClipboard("hello", { env: {}, stdout, runCommand })).resolves.toBe(true);

    expect(runCommand).toHaveBeenCalledWith(
      ["pbcopy"],
      expect.objectContaining({ timeoutMs: 3_000, input: "hello" }),
    );
    expect(stdout.write).not.toHaveBeenCalled();
  });

  it("falls back to OSC 52 in remote tmux sessions when tmux buffer integration fails", async () => {
    const runCommand = vi
      .fn()
      .mockResolvedValueOnce({ code: 1, killed: false, stdout: "", stderr: "", signal: null })
      .mockResolvedValueOnce({ code: 1, killed: false, stdout: "", stderr: "", signal: null });
    const stdout = {
      isTTY: true,
      write: vi.fn().mockReturnValue(true),
    };

    await expect(
      copyToClipboard("hello", {
        env: {
          SSH_CONNECTION: "client host 22 22",
          TMUX: "/tmp/tmux-1000/default,123,0",
        },
        stdout,
        runCommand,
      }),
    ).resolves.toBe(true);

    expect(runCommand).toHaveBeenNthCalledWith(
      1,
      ["tmux", "load-buffer", "-"],
      expect.objectContaining({ timeoutMs: 3_000, input: "hello" }),
    );
    expect(runCommand).toHaveBeenNthCalledWith(
      2,
      ["tmux", "set-buffer", "--"],
      expect.objectContaining({ timeoutMs: 3_000, input: "hello" }),
    );
    expect(stdout.write).toHaveBeenCalledWith(
      "\u001bPtmux;\u001b\u001b]52;c;aGVsbG8=\u0007\u001b\\",
    );
  });

  it("returns false when no clipboard route is available", async () => {
    const runCommand = vi.fn();
    const stdout = {
      isTTY: false,
      write: vi.fn(),
    };

    await expect(
      copyToClipboard("hello", {
        env: { SSH_CONNECTION: "client host 22 22" },
        stdout,
        runCommand,
      }),
    ).resolves.toBe(false);

    expect(runCommand).not.toHaveBeenCalled();
    expect(stdout.write).not.toHaveBeenCalled();
  });
});
