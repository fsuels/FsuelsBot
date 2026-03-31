import type { TelemetrySnapshot } from "../../../src/shared/telemetry-store.ts";
import { createTelemetryStore } from "../../../src/shared/telemetry-store.ts";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

type WindowLike = Pick<
  Window,
  | "addEventListener"
  | "removeEventListener"
  | "setInterval"
  | "clearInterval"
  | "requestAnimationFrame"
>;

type ActiveRun = {
  startedAt: number;
  firstTokenRecorded: boolean;
  cancelRequestedAt?: number;
};

type ActiveTool = {
  startedAt: number;
  name: string;
};

const CURRENT_SNAPSHOT_KEY = "openclaw.ui.telemetry.current";
const LAST_SESSION_SNAPSHOT_KEY = "openclaw.ui.telemetry.last-session";

function safeParseSnapshot(raw: string | null): TelemetrySnapshot | null {
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as TelemetrySnapshot;
  } catch {
    return null;
  }
}

/**
 * Browser-side telemetry for the control UI. It stays bounded in memory, keeps
 * the last session snapshot around for debugging, and records only the timings
 * we can actually act on inside the client.
 */
export function createUiTelemetry(
  params: {
    now?: () => number;
    storage?: StorageLike | null;
    win?: WindowLike | null;
    flushIntervalMs?: number;
  } = {},
) {
  const now = params.now ?? Date.now;
  const storage = params.storage ?? (typeof localStorage === "undefined" ? null : localStorage);
  const win = params.win ?? (typeof window === "undefined" ? null : window);
  const store = createTelemetryStore({ now });
  const activeRuns = new Map<string, ActiveRun>();
  const activeTools = new Map<string, ActiveTool>();
  const flushIntervalMs = Math.max(1_000, params.flushIntervalMs ?? 15_000);
  let flushTimer: number | null = null;
  let started = false;
  let lastSessionSnapshot = safeParseSnapshot(storage?.getItem(LAST_SESSION_SNAPSHOT_KEY) ?? null);

  const flush = (target: "current" | "last-session" = "current") => {
    if (!storage) {
      return;
    }
    const snapshot = store.getAll();
    storage.setItem(
      target === "last-session" ? LAST_SESSION_SNAPSHOT_KEY : CURRENT_SNAPSHOT_KEY,
      JSON.stringify(snapshot),
    );
    if (target === "last-session") {
      lastSessionSnapshot = snapshot;
    }
  };

  const handlePageHide = () => flush("last-session");
  const handleVisibilityChange = () => {
    if (document.visibilityState === "hidden") {
      flush("current");
    }
  };

  const increment = (name: string, delta?: number) => store.increment(name, delta);
  const set = (name: string, value: number) => store.set(name, value);
  const observe = (name: string, value: number) => store.observe(name, value);
  const add = (name: string, value: string) => store.add(name, value);
  const getAll = () => store.getAll();

  const notePromptFinished = (runId: string, finishedAt = now()) => {
    const run = activeRuns.get(runId);
    if (!run) {
      return;
    }
    observe("prompt_to_done_ms", Math.max(0, finishedAt - run.startedAt));
    if (run.cancelRequestedAt != null) {
      observe("cancel_latency_ms", Math.max(0, finishedAt - run.cancelRequestedAt));
    }
    activeRuns.delete(runId);
  };

  const notePromptError = (runId?: string) => {
    increment("error_count");
    if (runId) {
      notePromptFinished(runId);
    }
  };

  return {
    increment,
    set,
    observe,
    add,
    getAll,

    start() {
      if (started || !win) {
        return;
      }
      started = true;
      flushTimer = win.setInterval(() => flush("current"), flushIntervalMs);
      win.addEventListener("pagehide", handlePageHide);
      win.addEventListener("beforeunload", handlePageHide);
      if (typeof document !== "undefined") {
        document.addEventListener("visibilitychange", handleVisibilityChange);
      }
    },

    stop() {
      if (!started || !win) {
        return;
      }
      started = false;
      if (flushTimer != null) {
        win.clearInterval(flushTimer);
        flushTimer = null;
      }
      flush("last-session");
      win.removeEventListener("pagehide", handlePageHide);
      win.removeEventListener("beforeunload", handlePageHide);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      }
    },

    flush,

    getLastSessionSnapshot() {
      return lastSessionSnapshot;
    },

    notePromptStarted(runId: string, startedAt = now()) {
      activeRuns.set(runId, {
        startedAt,
        firstTokenRecorded: false,
      });
    },

    noteFirstToken(runId: string, firstTokenAt = now()) {
      const run = activeRuns.get(runId);
      if (!run || run.firstTokenRecorded) {
        return;
      }
      run.firstTokenRecorded = true;
      observe("prompt_to_first_token_ms", Math.max(0, firstTokenAt - run.startedAt));
    },

    noteCancelRequested(runId: string, requestedAt = now()) {
      const run = activeRuns.get(runId);
      if (!run) {
        return;
      }
      run.cancelRequestedAt = requestedAt;
    },

    notePromptFinished,

    notePromptError,

    noteToolStarted(toolCallId: string, name: string, startedAt = now()) {
      activeTools.set(toolCallId, { startedAt, name });
      add("unique_tool_names", name);
    },

    noteToolFinished(toolCallId: string, finishedAt = now()) {
      const tool = activeTools.get(toolCallId);
      if (!tool) {
        return;
      }
      observe("tool_call_ms", Math.max(0, finishedAt - tool.startedAt));
      activeTools.delete(toolCallId);
    },

    noteOverlayCount(count: number) {
      set("active_overlay_count", count);
    },

    noteRenderFrame(ms: number) {
      store.observe("render_frame_ms", ms);
    },
  };
}
