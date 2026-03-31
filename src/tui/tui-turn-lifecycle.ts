export type TuiTurnPhase =
  | "idle"
  | "reserving"
  | "running"
  | "paused"
  | "completed"
  | "cancelled"
  | "failed";

export type TuiTurnActivity =
  | "idle"
  | "sending"
  | "waiting"
  | "streaming"
  | "running"
  | "paused"
  | "aborted"
  | "error";

export type TuiTurnLifecycleSnapshot = {
  phase: TuiTurnPhase;
  runId: string | null;
  activeRunId: string | null;
  activeSinceMs: number | null;
  activityLabel: TuiTurnActivity;
  isExternalLoading: boolean;
  isTurnActive: boolean;
  isLoading: boolean;
};

export type TuiTurnLifecycleStore = {
  subscribe: (listener: (snapshot: TuiTurnLifecycleSnapshot) => void) => () => void;
  getSnapshot: () => TuiTurnLifecycleSnapshot;
  reserve: (runId: string) => boolean;
  adoptObservedRun: (
    runId: string,
    activity?: Extract<TuiTurnActivity, "waiting" | "streaming" | "running" | "paused">,
  ) => boolean;
  markWaiting: (runId: string) => boolean;
  markStreaming: (runId: string) => boolean;
  markRunning: (runId: string) => boolean;
  pause: (runId: string) => boolean;
  complete: (runId: string) => boolean;
  cancel: (runId?: string | null) => boolean;
  fail: (runId?: string | null) => boolean;
  reset: () => boolean;
  setExternalLoading: (value: boolean) => boolean;
};

type InternalState = {
  phase: TuiTurnPhase;
  runId: string | null;
  activeSinceMs: number | null;
  activityLabel: TuiTurnActivity;
  isExternalLoading: boolean;
};

function isActivePhase(phase: TuiTurnPhase): boolean {
  return phase === "reserving" || phase === "running" || phase === "paused";
}

function isTerminalPhase(phase: TuiTurnPhase): boolean {
  return phase === "completed" || phase === "cancelled" || phase === "failed";
}

function normalizeRunId(runId: string | null | undefined): string | null {
  if (typeof runId !== "string") {
    return null;
  }
  const trimmed = runId.trim();
  return trimmed || null;
}

function buildSnapshot(state: InternalState): TuiTurnLifecycleSnapshot {
  const isTurnActive = isActivePhase(state.phase);
  return {
    phase: state.phase,
    runId: state.runId,
    activeRunId: isTurnActive ? state.runId : null,
    activeSinceMs: isTurnActive ? state.activeSinceMs : null,
    activityLabel: state.activityLabel,
    isExternalLoading: state.isExternalLoading,
    isTurnActive,
    isLoading: isTurnActive || state.isExternalLoading,
  };
}

export function createTuiTurnLifecycleStore(params?: {
  now?: () => number;
}): TuiTurnLifecycleStore {
  const now = params?.now ?? (() => Date.now());
  let state: InternalState = {
    phase: "idle",
    runId: null,
    activeSinceMs: null,
    activityLabel: "idle",
    isExternalLoading: false,
  };
  const listeners = new Set<(snapshot: TuiTurnLifecycleSnapshot) => void>();

  const getSnapshot = () => buildSnapshot(state);

  const update = (next: InternalState): boolean => {
    if (
      next.phase === state.phase &&
      next.runId === state.runId &&
      next.activeSinceMs === state.activeSinceMs &&
      next.activityLabel === state.activityLabel &&
      next.isExternalLoading === state.isExternalLoading
    ) {
      return false;
    }
    state = next;
    const snapshot = getSnapshot();
    for (const listener of listeners) {
      listener(snapshot);
    }
    return true;
  };

  const transitionActive = (
    runId: string,
    phase: Extract<TuiTurnPhase, "reserving" | "running" | "paused">,
    activityLabel: Extract<
      TuiTurnActivity,
      "sending" | "waiting" | "streaming" | "running" | "paused"
    >,
  ): boolean => {
    const normalizedRunId = normalizeRunId(runId);
    if (!normalizedRunId) {
      return false;
    }
    if (isActivePhase(state.phase) && state.runId && state.runId !== normalizedRunId) {
      return false;
    }
    if (isTerminalPhase(state.phase) && state.runId === normalizedRunId) {
      return false;
    }
    const activeSinceMs =
      state.runId === normalizedRunId && isActivePhase(state.phase) && state.activeSinceMs !== null
        ? state.activeSinceMs
        : now();
    return update({
      ...state,
      phase,
      runId: normalizedRunId,
      activeSinceMs,
      activityLabel,
    });
  };

  const transitionTerminal = (
    runId: string | null | undefined,
    phase: Extract<TuiTurnPhase, "completed" | "cancelled" | "failed">,
    activityLabel: Extract<TuiTurnActivity, "idle" | "aborted" | "error">,
  ): boolean => {
    const normalizedRunId = normalizeRunId(runId);
    if (!normalizedRunId || state.runId !== normalizedRunId || isTerminalPhase(state.phase)) {
      return false;
    }
    return update({
      ...state,
      phase,
      runId: normalizedRunId,
      activeSinceMs: null,
      activityLabel,
    });
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot,
    reserve(runId) {
      return transitionActive(runId, "reserving", "sending");
    },
    adoptObservedRun(runId, activity = "running") {
      return transitionActive(runId, activity === "paused" ? "paused" : "running", activity);
    },
    markWaiting(runId) {
      return transitionActive(runId, "running", "waiting");
    },
    markStreaming(runId) {
      return transitionActive(runId, "running", "streaming");
    },
    markRunning(runId) {
      return transitionActive(runId, "running", "running");
    },
    pause(runId) {
      return transitionActive(runId, "paused", "paused");
    },
    complete(runId) {
      return transitionTerminal(runId, "completed", "idle");
    },
    cancel(runId) {
      return transitionTerminal(runId ?? state.runId, "cancelled", "aborted");
    },
    fail(runId) {
      return transitionTerminal(runId ?? state.runId, "failed", "error");
    },
    reset() {
      return update({
        ...state,
        phase: "idle",
        runId: null,
        activeSinceMs: null,
        activityLabel: "idle",
      });
    },
    setExternalLoading(value) {
      return update({
        ...state,
        isExternalLoading: value,
      });
    },
  };
}
