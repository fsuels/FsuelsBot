import { afterEach, describe, expect, it, vi } from "vitest";
import { handleAgentEvent, resetToolStream, type AgentReaction } from "./app-tool-stream.ts";

type TestHost = {
  sessionKey: string;
  chatRunId: string | null;
  toolStreamById: Map<string, unknown>;
  toolStreamOrder: string[];
  chatToolMessages: Record<string, unknown>[];
  toolStreamSyncTimer: number | null;
  telemetry: {
    noteToolStarted: ReturnType<typeof vi.fn>;
    noteToolFinished: ReturnType<typeof vi.fn>;
  };
  chatReaction: AgentReaction | null;
  chatReactionClearTimer: number | null;
};

function createHost(overrides: Partial<TestHost> = {}): TestHost {
  return {
    sessionKey: "main",
    chatRunId: "run-1",
    toolStreamById: new Map(),
    toolStreamOrder: [],
    chatToolMessages: [],
    toolStreamSyncTimer: null,
    telemetry: {
      noteToolStarted: vi.fn(),
      noteToolFinished: vi.fn(),
    },
    chatReaction: null,
    chatReactionClearTimer: null,
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("app tool stream reactions", () => {
  it("maps compaction start and end into session-scoped reactions", () => {
    const host = createHost();

    handleAgentEvent(host, {
      runId: "run-1",
      seq: 1,
      stream: "compaction",
      ts: 1_000,
      sessionKey: "main",
      data: { phase: "start" },
    });

    expect(host.chatReaction).toEqual({
      text: "Compacting context...",
      createdAt: 1_000,
      ttlMs: 60_000,
      channel: "system",
      style: "idle",
    });

    handleAgentEvent(host, {
      runId: "run-1",
      seq: 2,
      stream: "compaction",
      ts: 2_000,
      sessionKey: "main",
      data: { phase: "end", willRetry: false },
    });

    expect(host.chatReaction).toEqual({
      text: "Context compacted",
      createdAt: 2_000,
      ttlMs: 5_000,
      channel: "system",
      style: "success",
    });
  });

  it("replaces older reactions and clears them after ttl", () => {
    vi.useFakeTimers();
    const host = createHost();

    handleAgentEvent(host, {
      runId: "run-1",
      seq: 1,
      stream: "compaction",
      ts: 1_000,
      sessionKey: "main",
      data: { phase: "start" },
    });
    expect(host.chatReaction?.text).toBe("Compacting context...");

    handleAgentEvent(host, {
      runId: "run-1",
      seq: 2,
      stream: "compaction",
      ts: 1_500,
      sessionKey: "main",
      data: { phase: "end", willRetry: true },
    });
    expect(host.chatReaction?.text).toBe("Retrying compaction...");

    vi.advanceTimersByTime(4_999);
    expect(host.chatReaction?.text).toBe("Retrying compaction...");

    vi.advanceTimersByTime(1);
    expect(host.chatReaction).toBeNull();
  });

  it("ignores reactions for other sessions", () => {
    const host = createHost();

    handleAgentEvent(host, {
      runId: "run-2",
      seq: 1,
      stream: "compaction",
      ts: 1_000,
      sessionKey: "other",
      data: { phase: "start" },
    });

    expect(host.chatReaction).toBeNull();
  });

  it("surfaces tool failures as error reactions", () => {
    const host = createHost();

    handleAgentEvent(host, {
      runId: "run-1",
      seq: 1,
      stream: "tool",
      ts: 1_000,
      sessionKey: "main",
      data: {
        phase: "result",
        name: "web_search",
        toolCallId: "tool-1",
        isError: true,
      },
    });

    expect(host.chatReaction).toEqual({
      text: "web search failed",
      createdAt: 1_000,
      ttlMs: 5_000,
      channel: "tool",
      style: "error",
    });
  });

  it("clears reactions when the tool stream resets", () => {
    const host = createHost({
      chatReaction: {
        text: "Context compacted",
        createdAt: 1_000,
        ttlMs: 5_000,
        channel: "system",
        style: "success",
      },
    });

    resetToolStream(host);

    expect(host.chatReaction).toBeNull();
  });
});
