import type { TuiTurnLifecycleSnapshot } from "./tui-turn-lifecycle.js";
import { formatDurationCompact } from "../infra/format-time/format-duration.ts";
import { truncateToDisplayWidth } from "../terminal/ansi.js";
import { buildWaitingStatusMessage } from "./tui-waiting.js";

type StatusLineTheme = {
  dim: (value: string) => string;
  bold: (value: string) => string;
  accentSoft: (value: string) => string;
};

export function resolveStatusTickMs(
  snapshot: TuiTurnLifecycleSnapshot,
  _nowMs: number,
): number | null {
  if (!snapshot.isLoading) {
    return null;
  }
  if (snapshot.activityLabel === "waiting") {
    return 200;
  }
  if (snapshot.activityLabel === "streaming" || snapshot.activityLabel === "sending") {
    return 500;
  }
  return 1_000;
}

function clipStatusLine(text: string, width: number): string {
  const safeWidth = Number.isFinite(width) && width > 0 ? Math.max(4, Math.floor(width)) : 80;
  return truncateToDisplayWidth(text, safeWidth);
}

export function buildBusyStatusLine(params: {
  snapshot: TuiTurnLifecycleSnapshot;
  connectionStatus: string;
  width: number;
  theme: StatusLineTheme;
  nowMs: number;
  tick: number;
}) {
  const elapsedMs =
    typeof params.snapshot.activeSinceMs === "number"
      ? Math.max(0, params.nowMs - params.snapshot.activeSinceMs)
      : 0;
  const elapsed = formatDurationCompact(elapsedMs, { spaced: true }) ?? "0ms";

  if (params.snapshot.activityLabel === "waiting") {
    return clipStatusLine(
      buildWaitingStatusMessage({
        theme: params.theme,
        tick: params.tick,
        elapsed,
        connectionStatus: params.connectionStatus,
      }),
      params.width,
    );
  }

  return clipStatusLine(
    `${params.theme.bold(params.theme.accentSoft(params.snapshot.activityLabel))} • ${elapsed} | ${params.connectionStatus}`,
    params.width,
  );
}

export function buildIdleStatusLine(params: {
  connectionStatus: string;
  activityStatus: string;
  width: number;
  theme: StatusLineTheme;
}) {
  return clipStatusLine(
    params.theme.dim(`${params.connectionStatus} | ${params.activityStatus}`),
    params.width,
  );
}
