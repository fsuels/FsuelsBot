import type { SessionEntry } from "../../config/sessions.js";

const DEFAULT_AUTO_RESET_THRESHOLD = 0.85;
const MIN_AUTO_RESET_THRESHOLD = 0.6;
const MAX_AUTO_RESET_THRESHOLD = 0.98;

function parseThreshold(raw: string | undefined): number | undefined {
  if (!raw?.trim()) {
    return undefined;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return Math.min(MAX_AUTO_RESET_THRESHOLD, Math.max(MIN_AUTO_RESET_THRESHOLD, parsed));
}

export function resolveAutoResetContextThreshold(): number {
  return (
    parseThreshold(process.env.OPENCLAW_CONTEXT_PRESSURE_RESET_THRESHOLD) ??
    DEFAULT_AUTO_RESET_THRESHOLD
  );
}

export function shouldAutoResetSessionForContextPressure(
  entry: SessionEntry | undefined,
  threshold = resolveAutoResetContextThreshold(),
): boolean {
  if (process.env.OPENCLAW_CONTEXT_PRESSURE_AUTO_RESET === "0") {
    return false;
  }
  if (!entry) {
    return false;
  }

  const used = typeof entry.totalTokens === "number" ? entry.totalTokens : undefined;
  const budget = typeof entry.contextTokens === "number" ? entry.contextTokens : undefined;
  if (!used || !budget || budget <= 0) {
    return false;
  }

  return used >= budget * threshold;
}
