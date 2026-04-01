import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  beginHealthNoticeGrace,
  createNoticeCenterState,
  ingestHealthSnapshot,
  publishNotice,
  type Notice,
  type NoticeCenterHost,
} from "./notice-center.ts";

type TestHost = NoticeCenterHost;

function createHost(now = 0): TestHost {
  return {
    chatReaction: null,
    chatReactionClearTimer: null,
    noticeCenterState: createNoticeCenterState({ now, everConnected: {} }),
    runtimeDiagnostics: [],
    runtimeDiagnosticsByKey: new Map(),
  };
}

function foldCount(text: string): Notice["fold"] {
  return (existing, incoming) => ({
    ...incoming,
    count: (existing.count ?? 1) + 1,
    text: `${text} x${(existing.count ?? 1) + 1}`,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe("notice center", () => {
  it("dedupes identical notices without re-emitting the transient reaction", () => {
    const host = createHost();

    vi.setSystemTime(1_000);
    publishNotice(host, {
      key: "tool:error:web_search",
      text: "web search failed",
      level: "error",
      ttlMs: 5_000,
      diagnosticKey: "tool:error:web_search",
      detail: "HTTP 500",
    });

    vi.setSystemTime(1_500);
    publishNotice(host, {
      key: "tool:error:web_search",
      text: "web search failed",
      level: "error",
      ttlMs: 5_000,
      diagnosticKey: "tool:error:web_search",
      detail: "HTTP 500",
    });

    expect(host.chatReaction?.createdAt).toBe(1_000);
    expect(host.runtimeDiagnostics).toHaveLength(1);
    expect(host.runtimeDiagnostics[0]).toMatchObject({
      key: "tool:error:web_search",
      count: 2,
      active: true,
    });
  });

  it("folds repeated notices and keeps persistent diagnostics after ttl expiry", () => {
    const host = createHost();

    vi.setSystemTime(1_000);
    publishNotice(host, {
      key: "tool:error:web_search",
      text: "web search failed",
      level: "error",
      ttlMs: 5_000,
      diagnosticKey: "tool:error:web_search",
      detail: "HTTP 500",
      fold: foldCount("web search failed"),
    });

    vi.setSystemTime(1_500);
    publishNotice(host, {
      key: "tool:error:web_search",
      text: "web search failed",
      level: "error",
      ttlMs: 5_000,
      diagnosticKey: "tool:error:web_search",
      detail: "HTTP 500",
      fold: foldCount("web search failed"),
    });

    expect(host.chatReaction?.text).toBe("web search failed x2");
    expect(host.runtimeDiagnostics[0]?.count).toBe(2);

    vi.setSystemTime(6_500);
    vi.advanceTimersByTime(5_000);

    expect(host.chatReaction).toBeNull();
    expect(host.runtimeDiagnostics[0]).toMatchObject({
      key: "tool:error:web_search",
      active: false,
      count: 2,
    });
  });

  it("invalidates inverse notices and falls back to older active notices after expiry", () => {
    const host = createHost();

    vi.setSystemTime(1_000);
    publishNotice(host, {
      key: "lifecycle:running",
      text: "Agent running...",
      level: "info",
      ttlMs: 10_000,
    });

    vi.setSystemTime(2_000);
    publishNotice(host, {
      key: "health:telegram:failed",
      text: "Telegram health check failed",
      level: "error",
      ttlMs: 1_000,
      stickyDiagnostic: true,
      diagnosticKey: "health:telegram",
    });

    expect(host.chatReaction?.text).toBe("Telegram health check failed");

    vi.setSystemTime(3_001);
    vi.advanceTimersByTime(1_001);

    expect(host.chatReaction?.text).toBe("Agent running...");

    publishNotice(host, {
      key: "health:telegram:connected",
      text: "Telegram recovered",
      level: "success",
      ttlMs: 5_000,
      invalidates: ["health:telegram:failed"],
    });

    expect(host.chatReaction?.text).toBe("Telegram recovered");
  });

  it("suppresses non-regression health alerts until a connector previously worked", () => {
    const host = createHost();
    beginHealthNoticeGrace(host, 0);

    vi.setSystemTime(1_000);
    ingestHealthSnapshot(host, {
      channels: {
        telegram: {
          accounts: {
            default: {
              accountId: "default",
              configured: true,
              probe: { ok: false, status: 500, error: "gateway timeout" },
            },
          },
        },
      },
      channelLabels: { telegram: "Telegram" },
    });

    expect(host.chatReaction).toBeNull();
    expect(host.runtimeDiagnostics[0]).toMatchObject({
      key: "health:telegram:default",
      active: true,
    });

    vi.setSystemTime(2_000);
    ingestHealthSnapshot(host, {
      channels: {
        telegram: {
          accounts: {
            default: {
              accountId: "default",
              configured: true,
              probe: { ok: true },
            },
          },
        },
      },
      channelLabels: { telegram: "Telegram" },
    });

    expect(host.chatReaction).toBeNull();
    expect(host.noticeCenterState.healthEverConnected["health:telegram:default"]).toBe(true);

    vi.setSystemTime(3_000);
    ingestHealthSnapshot(host, {
      channels: {
        telegram: {
          accounts: {
            default: {
              accountId: "default",
              configured: true,
              probe: { ok: false, status: 500, error: "gateway timeout" },
            },
          },
        },
      },
      channelLabels: { telegram: "Telegram" },
    });

    expect(host.chatReaction?.text).toBe("Telegram health check failed");
    expect(host.runtimeDiagnostics[0]).toMatchObject({
      key: "health:telegram:default",
      active: true,
    });
  });

  it("suppresses never-connected hints during startup grace and records them afterward", () => {
    const host = createHost();
    beginHealthNoticeGrace(host, 0);

    ingestHealthSnapshot(host, {
      channels: {
        slack: {
          accounts: {
            default: {
              accountId: "default",
              configured: true,
            },
          },
        },
      },
      channelLabels: { slack: "Slack" },
    });

    expect(host.runtimeDiagnostics).toHaveLength(0);

    vi.setSystemTime(20_000);
    ingestHealthSnapshot(host, {
      channels: {
        slack: {
          accounts: {
            default: {
              accountId: "default",
              configured: true,
            },
          },
        },
      },
      channelLabels: { slack: "Slack" },
    });

    expect(host.chatReaction).toBeNull();
    expect(host.runtimeDiagnostics[0]).toMatchObject({
      key: "health:slack:default",
      title: "Slack has not connected yet",
      active: true,
    });
  });
});
