import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const callGatewayMock = vi.fn();
const readSessionUpdatedAtMock = vi.fn(() => undefined);
const hasSystemEventsMock = vi.fn(() => false);
const listFinishedSessionsMock = vi.fn(() => []);
const listSubagentRunsForRequesterMock = vi.fn(() => []);

vi.mock("../gateway/call.js", () => ({
  callGateway: (opts: unknown) => callGatewayMock(opts),
}));

vi.mock("../config/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config/config.js")>();
  return {
    ...actual,
    loadConfig: () => ({
      session: {
        store: "/tmp/openclaw-test-sessions-{agentId}.json",
      },
    }),
  };
});

vi.mock("../config/sessions.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config/sessions.js")>();
  return {
    ...actual,
    resolveStorePath: () => "/tmp/openclaw-test-sessions.json",
    readSessionUpdatedAt: (params: unknown) => readSessionUpdatedAtMock(params),
  };
});

vi.mock("../infra/system-events.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../infra/system-events.js")>();
  return {
    ...actual,
    hasSystemEvents: (sessionKey: string) => hasSystemEventsMock(sessionKey),
  };
});

vi.mock("./bash-process-registry.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./bash-process-registry.js")>();
  return {
    ...actual,
    listFinishedSessions: () => listFinishedSessionsMock(),
  };
});

vi.mock("./subagent-registry.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./subagent-registry.js")>();
  return {
    ...actual,
    listSubagentRunsForRequester: (sessionKey: string) =>
      listSubagentRunsForRequesterMock(sessionKey),
  };
});

import {
  listPendingSleeps,
  registerSleep,
  resetSleepRegistryForTests,
  resolveSleepHeuristics,
} from "./sleep-registry.js";

describe("sleep registry", () => {
  const previousLongTick = process.env.OPENCLAW_SLEEP_LONG_TICK_MS;

  beforeEach(() => {
    vi.useFakeTimers();
    callGatewayMock.mockReset();
    callGatewayMock.mockResolvedValue({ runId: "run-1" });
    readSessionUpdatedAtMock.mockReset();
    readSessionUpdatedAtMock.mockReturnValue(undefined);
    hasSystemEventsMock.mockReset();
    hasSystemEventsMock.mockReturnValue(false);
    listFinishedSessionsMock.mockReset();
    listFinishedSessionsMock.mockReturnValue([]);
    listSubagentRunsForRequesterMock.mockReset();
    listSubagentRunsForRequesterMock.mockReturnValue([]);
    delete process.env.OPENCLAW_SLEEP_LONG_TICK_MS;
    resetSleepRegistryForTests();
  });

  afterEach(() => {
    resetSleepRegistryForTests();
    vi.useRealTimers();
    if (previousLongTick === undefined) {
      delete process.env.OPENCLAW_SLEEP_LONG_TICK_MS;
    } else {
      process.env.OPENCLAW_SLEEP_LONG_TICK_MS = previousLongTick;
    }
  });

  it("registers a short non-blocking sleep and wakes at the requested time", async () => {
    const registered = registerSleep({
      sessionKey: "agent:main:main",
      wakeAt: Date.now() + 5_000,
      reason: "wait for the timer",
    });

    expect(registered.tickIntervalMs).toBeUndefined();
    expect(listPendingSleeps()).toHaveLength(1);
    expect(callGatewayMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5_000);

    expect(callGatewayMock).toHaveBeenCalledTimes(1);
    expect(callGatewayMock.mock.calls[0]?.[0]).toMatchObject({
      method: "agent",
      params: expect.objectContaining({
        sessionKey: "agent:main:main",
        deliver: false,
      }),
    });
    const wakeCall = callGatewayMock.mock.calls[0]?.[0] as {
      params?: { extraSystemPrompt?: string };
    };
    expect(wakeCall?.params?.extraSystemPrompt).toContain("requested sleep duration has elapsed");
    expect(listPendingSleeps()).toHaveLength(0);
  });

  it("cancels interruptible sleep when the session receives newer activity", async () => {
    const registered = registerSleep({
      sessionKey: "agent:main:main",
      wakeAt: Date.now() + 5_000,
    });

    readSessionUpdatedAtMock.mockReturnValue(registered.scheduledAt + 1);

    await vi.advanceTimersByTimeAsync(5_000);

    expect(callGatewayMock).not.toHaveBeenCalled();
    expect(listPendingSleeps()).toHaveLength(0);
  });

  it("wakes on periodic ticks and includes pending task results in the wake prompt", async () => {
    const registered = registerSleep({
      sessionKey: "agent:main:main",
      wakeAt: Date.now() + 2 * 60_000,
    });

    listFinishedSessionsMock.mockReturnValue([
      {
        id: "shell-task-1",
        sessionKey: "agent:main:main",
        notified: false,
      },
    ]);

    await vi.advanceTimersByTimeAsync(registered.tickIntervalMs ?? 0);

    expect(callGatewayMock).toHaveBeenCalledTimes(1);
    const call = callGatewayMock.mock.calls[0]?.[0] as {
      params?: { extraSystemPrompt?: string };
    };
    expect(call.params?.extraSystemPrompt).toContain("Background task results are now available");
    expect(call.params?.extraSystemPrompt).toContain("shell-task-1");
  });

  it("uses configurable coarse tick intervals for long sleeps", () => {
    process.env.OPENCLAW_SLEEP_LONG_TICK_MS = "90000";

    const registered = registerSleep({
      sessionKey: "agent:main:main",
      wakeAt: Date.now() + 20 * 60_000,
    });

    expect(registered.tickIntervalMs).toBe(90_000);
  });

  it("derives cache-aware heuristics from context pruning config", () => {
    const heuristics = resolveSleepHeuristics({
      agents: {
        defaults: {
          contextPruning: {
            mode: "cache-ttl",
            ttl: "7m",
          },
        },
      },
    });

    expect(heuristics.cacheTtlMs).toBe(7 * 60_000);
  });
});
