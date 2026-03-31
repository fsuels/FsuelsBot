import type { GatewayBrowserClient } from "../gateway.ts";
import type { SessionsUsageResult, CostUsageSummary, SessionUsageTimeSeries } from "../types.ts";
import type { SessionLogEntry } from "../views/usage.ts";
import {
  beginAsyncGeneration,
  isCurrentAsyncGeneration,
  logDroppedAsyncGeneration,
} from "../async-generation.ts";

export type UsageState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  usageLoading: boolean;
  usageResult: SessionsUsageResult | null;
  usageCostSummary: CostUsageSummary | null;
  usageError: string | null;
  usageStartDate: string;
  usageEndDate: string;
  usageSelectedSessions: string[];
  usageSelectedDays: string[];
  usageTimeSeries: SessionUsageTimeSeries | null;
  usageTimeSeriesLoading: boolean;
  usageSessionLogs: SessionLogEntry[] | null;
  usageSessionLogsLoading: boolean;
};

export async function loadUsage(
  state: UsageState,
  overrides?: {
    startDate?: string;
    endDate?: string;
  },
) {
  if (!state.client || !state.connected) {
    return;
  }
  const startDate = overrides?.startDate ?? state.usageStartDate;
  const endDate = overrides?.endDate ?? state.usageEndDate;
  const generation = beginAsyncGeneration(state, "usage.load");
  state.usageLoading = true;
  state.usageError = null;
  try {
    // Load both endpoints in parallel
    const [sessionsRes, costRes] = await Promise.all([
      state.client.request("sessions.usage", {
        startDate,
        endDate,
        limit: 1000, // Cap at 1000 sessions
        includeContextWeight: true,
      }),
      state.client.request("usage.cost", { startDate, endDate }),
    ]);

    if (!isCurrentAsyncGeneration(state, "usage.load", generation)) {
      logDroppedAsyncGeneration("usage.load", { startDate, endDate });
      return;
    }
    if (sessionsRes) {
      state.usageResult = sessionsRes as SessionsUsageResult;
    }
    if (costRes) {
      state.usageCostSummary = costRes as CostUsageSummary;
    }
  } catch (err) {
    if (!isCurrentAsyncGeneration(state, "usage.load", generation)) {
      logDroppedAsyncGeneration("usage.load", { startDate, endDate, phase: "error" });
      return;
    }
    state.usageError = String(err);
  } finally {
    if (isCurrentAsyncGeneration(state, "usage.load", generation)) {
      state.usageLoading = false;
    }
  }
}

export async function loadSessionTimeSeries(state: UsageState, sessionKey: string) {
  if (!state.client || !state.connected) {
    return;
  }
  const generation = beginAsyncGeneration(state, "usage.timeseries");
  state.usageTimeSeriesLoading = true;
  state.usageTimeSeries = null;
  try {
    const res = await state.client.request("sessions.usage.timeseries", { key: sessionKey });
    if (!isCurrentAsyncGeneration(state, "usage.timeseries", generation)) {
      logDroppedAsyncGeneration("usage.timeseries", { sessionKey });
      return;
    }
    if (res) {
      state.usageTimeSeries = res as SessionUsageTimeSeries;
    }
  } catch {
    if (!isCurrentAsyncGeneration(state, "usage.timeseries", generation)) {
      logDroppedAsyncGeneration("usage.timeseries", { sessionKey, phase: "error" });
      return;
    }
    // Silently fail - time series is optional
    state.usageTimeSeries = null;
  } finally {
    if (isCurrentAsyncGeneration(state, "usage.timeseries", generation)) {
      state.usageTimeSeriesLoading = false;
    }
  }
}

export async function loadSessionLogs(state: UsageState, sessionKey: string) {
  if (!state.client || !state.connected) {
    return;
  }
  const generation = beginAsyncGeneration(state, "usage.logs");
  state.usageSessionLogsLoading = true;
  state.usageSessionLogs = null;
  try {
    const res = await state.client.request("sessions.usage.logs", { key: sessionKey, limit: 500 });
    if (!isCurrentAsyncGeneration(state, "usage.logs", generation)) {
      logDroppedAsyncGeneration("usage.logs", { sessionKey });
      return;
    }
    if (res && Array.isArray((res as { logs: SessionLogEntry[] }).logs)) {
      state.usageSessionLogs = (res as { logs: SessionLogEntry[] }).logs;
    }
  } catch {
    if (!isCurrentAsyncGeneration(state, "usage.logs", generation)) {
      logDroppedAsyncGeneration("usage.logs", { sessionKey, phase: "error" });
      return;
    }
    // Silently fail - logs are optional
    state.usageSessionLogs = null;
  } finally {
    if (isCurrentAsyncGeneration(state, "usage.logs", generation)) {
      state.usageSessionLogsLoading = false;
    }
  }
}
