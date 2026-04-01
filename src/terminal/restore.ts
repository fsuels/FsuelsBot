import { buildTerminalResetSequence } from "./codec.js";
import { clearActiveProgressLine } from "./progress-line.js";

const RESET_SEQUENCE = buildTerminalResetSequence();

function reportRestoreFailure(scope: string, err: unknown, reason?: string): void {
  const suffix = reason ? ` (${reason})` : "";
  const message = `[terminal] restore ${scope} failed${suffix}: ${String(err)}`;
  try {
    process.stderr.write(`${message}\n`);
  } catch (writeErr) {
    console.error(`[terminal] restore reporting failed${suffix}: ${String(writeErr)}`);
  }
}

export function restoreTerminalState(reason?: string): void {
  try {
    clearActiveProgressLine();
  } catch (err) {
    reportRestoreFailure("progress line", err, reason);
  }

  const stdin = process.stdin;
  if (stdin.isTTY && typeof stdin.setRawMode === "function") {
    try {
      stdin.setRawMode(false);
    } catch (err) {
      reportRestoreFailure("raw mode", err, reason);
    }
    if (typeof stdin.isPaused === "function" && stdin.isPaused()) {
      try {
        stdin.resume();
      } catch (err) {
        reportRestoreFailure("stdin resume", err, reason);
      }
    }
  }

  if (process.stdout.isTTY) {
    try {
      process.stdout.write(RESET_SEQUENCE);
    } catch (err) {
      reportRestoreFailure("stdout reset", err, reason);
    }
  }
}
