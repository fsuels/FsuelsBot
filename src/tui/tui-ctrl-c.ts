export type TuiCtrlCMode = "double-press-exit" | "exit" | "abort-or-exit";

export type TuiCtrlCAction = "close-overlay" | "clear-input" | "abort" | "arm-exit" | "exit";

export function resolveTuiCtrlCAction(params: {
  nowMs: number;
  lastCtrlCAt: number;
  mode: TuiCtrlCMode;
  hasActiveOverlay: boolean;
  hasEditorText: boolean;
  hasActiveRun: boolean;
  exitArmWindowMs?: number;
}): {
  action: TuiCtrlCAction;
  nextLastCtrlCAt: number;
  statusText?: string;
} {
  const exitArmWindowMs =
    Number.isFinite(params.exitArmWindowMs) && (params.exitArmWindowMs ?? 0) > 0
      ? Math.floor(params.exitArmWindowMs!)
      : 1_000;

  if (params.hasActiveOverlay) {
    return {
      action: "close-overlay",
      nextLastCtrlCAt: 0,
      statusText: "closed overlay",
    };
  }

  if (params.hasEditorText) {
    return {
      action: "clear-input",
      nextLastCtrlCAt: 0,
      statusText: "cleared input",
    };
  }

  if (params.mode === "abort-or-exit" && params.hasActiveRun) {
    return {
      action: "abort",
      nextLastCtrlCAt: 0,
      statusText: "aborting run",
    };
  }

  if (params.mode === "exit" || params.mode === "abort-or-exit") {
    return {
      action: "exit",
      nextLastCtrlCAt: 0,
    };
  }

  if (params.nowMs - params.lastCtrlCAt < exitArmWindowMs) {
    return {
      action: "exit",
      nextLastCtrlCAt: 0,
    };
  }

  return {
    action: "arm-exit",
    nextLastCtrlCAt: params.nowMs,
    statusText: "press ctrl+c again to exit",
  };
}
