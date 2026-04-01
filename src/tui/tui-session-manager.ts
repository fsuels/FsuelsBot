import type { Terminal, TUI } from "@mariozechner/pi-tui";
import { restoreTerminalState } from "../terminal/restore.js";

type MutableTuiState = {
  previousLines?: string[];
  previousWidth?: number;
  cursorRow?: number;
  hardwareCursorRow?: number;
  previousViewportTop?: number;
};

type StderrLike = Pick<NodeJS.WriteStream, "write">;
type StdoutLike = Pick<NodeJS.WriteStream, "columns" | "rows">;

export type TuiSessionManagerOptions = {
  tui: Pick<TUI, "requestRender" | "stop" | "invalidate">;
  terminal: Pick<Terminal, "drainInput">;
  stderr?: StderrLike;
  stdout?: StdoutLike;
  onResizeSync?: () => void;
  requestTerminalSizeRefresh?: () => void;
};

export type TuiSessionManager = ReturnType<typeof createTuiSessionManager>;

function invokeWriteCallback(
  encoding?: BufferEncoding | ((error?: Error | null) => void),
  cb?: (error?: Error | null) => void,
) {
  if (typeof encoding === "function") {
    encoding(null);
    return;
  }
  cb?.(null);
}

function writeChunkToString(
  chunk: string | Uint8Array,
  encoding?: BufferEncoding | ((error?: Error | null) => void),
) {
  if (typeof chunk === "string") {
    return chunk;
  }
  const resolvedEncoding =
    typeof encoding === "string" && encoding !== "buffer" ? encoding : "utf8";
  return Buffer.from(chunk).toString(resolvedEncoding);
}

export function createTuiSessionManager(options: TuiSessionManagerOptions) {
  const stderr = options.stderr ?? process.stderr;
  const stdout = options.stdout ?? process.stdout;
  let active = false;
  let cleanupPromise: Promise<void> | null = null;
  let repaintQueued = false;
  let lastSize = {
    columns: stdout.columns ?? 80,
    rows: stdout.rows ?? 24,
  };
  const capturedStderrWrites: string[] = [];
  const originalStderrWrite = stderr.write.bind(stderr);

  const scheduleRecoveryPaint = () => {
    if (!active || repaintQueued) {
      return;
    }
    repaintQueued = true;
    queueMicrotask(() => {
      repaintQueued = false;
      if (!active) {
        return;
      }
      options.tui.requestRender(true);
    });
  };

  const installStderrInterceptor = () => {
    stderr.write = ((chunk, encoding, cb) => {
      if (!active) {
        if (typeof encoding === "function") {
          return originalStderrWrite(chunk, encoding);
        }
        return originalStderrWrite(chunk, encoding, cb);
      }
      capturedStderrWrites.push(writeChunkToString(chunk, encoding));
      scheduleRecoveryPaint();
      invokeWriteCallback(encoding, cb);
      return true;
    }) as typeof stderr.write;
  };

  const restoreStderrInterceptor = () => {
    stderr.write = originalStderrWrite;
  };

  const writeCleanupNotice = () => {
    if (capturedStderrWrites.length === 0) {
      return;
    }
    const combined = capturedStderrWrites.join("");
    const trimmed = combined.trim();
    const capped = trimmed.slice(0, 4000);
    const truncated = capped.length < trimmed.length ? "\n[openclaw:tui] output truncated." : "";
    try {
      originalStderrWrite(
        `\n[openclaw:tui] captured ${capturedStderrWrites.length} stderr write(s) while the TUI was active.\n${capped}${truncated}\n`,
      );
    } catch {
      // Best effort only; never fail cleanup on reporting.
    }
  };

  const readSize = () => ({
    columns: stdout.columns ?? 80,
    rows: stdout.rows ?? 24,
  });

  return {
    activate() {
      if (active) {
        return;
      }
      active = true;
      cleanupPromise = null;
      lastSize = readSize();
      installStderrInterceptor();
    },
    handleResize() {
      const nextSize = readSize();
      if (nextSize.columns === lastSize.columns && nextSize.rows === lastSize.rows) {
        return;
      }
      lastSize = nextSize;
      options.onResizeSync?.();
      options.tui.requestRender();
    },
    handleSigCont() {
      lastSize = readSize();
      options.requestTerminalSizeRefresh?.();
      options.onResizeSync?.();
      options.tui.requestRender(true);
    },
    forceRedraw() {
      options.tui.requestRender(true);
    },
    invalidatePrevFrame() {
      const tui = options.tui as unknown as MutableTuiState;
      tui.previousLines = [];
      tui.previousWidth = stdout.columns ?? tui.previousWidth ?? 0;
      tui.cursorRow = 0;
      tui.hardwareCursorRow = 0;
      tui.previousViewportTop = 0;
      options.tui.invalidate?.();
      options.tui.requestRender();
    },
    async cleanup(reason?: string) {
      if (cleanupPromise) {
        await cleanupPromise;
        return;
      }
      cleanupPromise = (async () => {
        active = false;
        restoreStderrInterceptor();
        try {
          await options.terminal.drainInput();
        } catch {
          restoreTerminalState(reason ?? "tui cleanup drain failure");
        }
        try {
          options.tui.stop();
        } catch {
          restoreTerminalState(reason ?? "tui cleanup stop failure");
        }
        writeCleanupNotice();
      })();
      await cleanupPromise;
    },
    getCapturedStderrWrites() {
      return [...capturedStderrWrites];
    },
  };
}
