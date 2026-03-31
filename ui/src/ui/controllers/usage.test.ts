import { describe, expect, it, vi } from "vitest";
import type { CostUsageSummary, SessionsUsageResult, SessionUsageTimeSeries } from "../types.ts";
import type { SessionLogEntry } from "../views/usage.ts";
import { loadSessionLogs, loadSessionTimeSeries, loadUsage, type UsageState } from "./usage.ts";

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function emptyTotals() {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    totalCost: 0,
    inputCost: 0,
    outputCost: 0,
    cacheReadCost: 0,
    cacheWriteCost: 0,
    missingCostEntries: 0,
  };
}

function createUsageResult(startDate: string, endDate: string, label: string): SessionsUsageResult {
  return {
    updatedAt: Date.now(),
    startDate,
    endDate,
    sessions: [
      {
        key: label,
        label,
        usage: emptyTotals(),
      },
    ],
    totals: emptyTotals(),
    aggregates: {
      messages: { total: 0, user: 0, assistant: 0, toolCalls: 0, toolResults: 0, errors: 0 },
      tools: { totalCalls: 0, uniqueTools: 0, tools: [] },
      byModel: [],
      byProvider: [],
      byAgent: [],
      byChannel: [],
      daily: [],
    },
  };
}

function createCostSummary(label: string): CostUsageSummary {
  return {
    updatedAt: Date.now(),
    days: 1,
    daily: [{ date: label, ...emptyTotals() }],
    totals: emptyTotals(),
  };
}

function createState(request: (method: string, params: unknown) => Promise<unknown>): UsageState {
  return {
    client: { request } as unknown as UsageState["client"],
    connected: true,
    usageLoading: false,
    usageResult: null,
    usageCostSummary: null,
    usageError: null,
    usageStartDate: "2026-01-01",
    usageEndDate: "2026-01-31",
    usageSelectedSessions: [],
    usageSelectedDays: [],
    usageTimeSeries: null,
    usageTimeSeriesLoading: false,
    usageSessionLogs: null,
    usageSessionLogsLoading: false,
  };
}

describe("usage controller", () => {
  it("drops stale usage responses when a newer date range finishes first", async () => {
    const janUsage = createDeferred<SessionsUsageResult>();
    const janCost = createDeferred<CostUsageSummary>();
    const febUsage = createDeferred<SessionsUsageResult>();
    const febCost = createDeferred<CostUsageSummary>();
    const request = vi.fn((method: string, params: unknown) => {
      const range = params as { startDate?: string };
      if (method === "sessions.usage" && range.startDate === "2026-01-01") {
        return janUsage.promise;
      }
      if (method === "usage.cost" && range.startDate === "2026-01-01") {
        return janCost.promise;
      }
      if (method === "sessions.usage" && range.startDate === "2026-02-01") {
        return febUsage.promise;
      }
      if (method === "usage.cost" && range.startDate === "2026-02-01") {
        return febCost.promise;
      }
      return Promise.resolve({});
    });
    const state = createState(request);

    const january = loadUsage(state, { startDate: "2026-01-01", endDate: "2026-01-31" });
    const february = loadUsage(state, { startDate: "2026-02-01", endDate: "2026-02-28" });

    febUsage.resolve(createUsageResult("2026-02-01", "2026-02-28", "feb"));
    febCost.resolve(createCostSummary("feb"));
    await february;

    expect(state.usageResult?.sessions[0]?.key).toBe("feb");
    expect(state.usageCostSummary?.daily[0]?.date).toBe("feb");

    janUsage.resolve(createUsageResult("2026-01-01", "2026-01-31", "jan"));
    janCost.resolve(createCostSummary("jan"));
    await january;

    expect(state.usageResult?.sessions[0]?.key).toBe("feb");
    expect(state.usageCostSummary?.daily[0]?.date).toBe("feb");
    expect(state.usageLoading).toBe(false);
  });

  it("keeps the newest time series selection when older requests finish later", async () => {
    const first = createDeferred<SessionUsageTimeSeries>();
    const second = createDeferred<SessionUsageTimeSeries>();
    const request = vi.fn((method: string, params: unknown) => {
      const payload = params as { key?: string };
      if (method === "sessions.usage.timeseries" && payload.key === "session-a") {
        return first.promise;
      }
      if (method === "sessions.usage.timeseries" && payload.key === "session-b") {
        return second.promise;
      }
      return Promise.resolve({});
    });
    const state = createState(request);

    const sessionA = loadSessionTimeSeries(state, "session-a");
    const sessionB = loadSessionTimeSeries(state, "session-b");

    second.resolve({ sessionId: "session-b", points: [] });
    await sessionB;
    expect(state.usageTimeSeries?.sessionId).toBe("session-b");

    first.resolve({ sessionId: "session-a", points: [] });
    await sessionA;
    expect(state.usageTimeSeries?.sessionId).toBe("session-b");
    expect(state.usageTimeSeriesLoading).toBe(false);
  });

  it("keeps the newest session logs selection when older requests finish later", async () => {
    const first = createDeferred<{ logs: SessionLogEntry[] }>();
    const second = createDeferred<{ logs: SessionLogEntry[] }>();
    const request = vi.fn((method: string, params: unknown) => {
      const payload = params as { key?: string };
      if (method === "sessions.usage.logs" && payload.key === "session-a") {
        return first.promise;
      }
      if (method === "sessions.usage.logs" && payload.key === "session-b") {
        return second.promise;
      }
      return Promise.resolve({});
    });
    const state = createState(request);

    const sessionA = loadSessionLogs(state, "session-a");
    const sessionB = loadSessionLogs(state, "session-b");

    second.resolve({
      logs: [{ timestamp: 2, role: "assistant", content: "newest" }] as SessionLogEntry[],
    });
    await sessionB;
    expect(state.usageSessionLogs?.[0]?.content).toBe("newest");

    first.resolve({
      logs: [{ timestamp: 1, role: "user", content: "stale" }] as SessionLogEntry[],
    });
    await sessionA;
    expect(state.usageSessionLogs?.[0]?.content).toBe("newest");
    expect(state.usageSessionLogsLoading).toBe(false);
  });
});
