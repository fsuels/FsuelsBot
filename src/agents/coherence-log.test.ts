import { describe, expect, it } from "vitest";
import {
  type CoherenceEntry,
  type CoherenceLogState,
  EventVerb,
  isStructuredEvent,
  buildToolMetaCoherenceEntry,
  buildToolCallCoherenceEntry,
  buildTaskTransitionEntry,
  buildModelSwitchEntry,
  buildSystemEventEntry,
  scoreEvent,
  selectEventsForInjection,
  formatEventMemoryInjection,
  formatEventMemoryStatus,
  createInitialCoherenceLog,
} from "./coherence-log.js";

// ---------------------------------------------------------------------------
// EventVerb type
// ---------------------------------------------------------------------------

describe("EventVerb", () => {
  it("contains 7 verbs", () => {
    expect(Object.keys(EventVerb)).toHaveLength(7);
  });

  it("has expected values", () => {
    expect(EventVerb.CHANGED).toBe("changed");
    expect(EventVerb.FAILED).toBe("failed");
    expect(EventVerb.DECIDED).toBe("decided");
    expect(EventVerb.REJECTED).toBe("rejected");
    expect(EventVerb.BLOCKED).toBe("blocked");
    expect(EventVerb.ESCALATED).toBe("escalated");
    expect(EventVerb.COMPACTED).toBe("compacted");
  });
});

// ---------------------------------------------------------------------------
// isStructuredEvent
// ---------------------------------------------------------------------------

describe("isStructuredEvent", () => {
  it("returns false for legacy entries without verb", () => {
    const legacy: CoherenceEntry = {
      ts: 1000,
      source: "tool_call",
      summary: "Edit: src/foo.ts",
    };
    expect(isStructuredEvent(legacy)).toBe(false);
  });

  it("returns true for entries with verb", () => {
    const structured: CoherenceEntry = {
      ts: 1000,
      source: "tool_call",
      summary: "Edit: src/foo.ts",
      verb: EventVerb.CHANGED,
      subject: "src/foo.ts",
      outcome: "ok",
    };
    expect(isStructuredEvent(structured)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Builder functions — verb/subject/outcome population
// ---------------------------------------------------------------------------

describe("buildToolMetaCoherenceEntry", () => {
  it("populates verb=changed, subject from meta, outcome=ok", () => {
    const entry = buildToolMetaCoherenceEntry({
      toolName: "edit",
      meta: "src/agents/foo.ts",
      taskId: "t1",
      now: 5000,
    });
    expect(entry).not.toBeNull();
    expect(entry!.verb).toBe(EventVerb.CHANGED);
    expect(entry!.subject).toBe("src/agents/foo.ts");
    expect(entry!.outcome).toBe("ok");
    expect(entry!.summary).toBe("Edit: src/agents/foo.ts");
  });

  it("falls back to tool name as subject when meta is absent", () => {
    const entry = buildToolMetaCoherenceEntry({
      toolName: "write",
      now: 5000,
    });
    expect(entry).not.toBeNull();
    expect(entry!.verb).toBe(EventVerb.CHANGED);
    expect(entry!.subject).toBe("write");
    expect(entry!.summary).toBe("Write call");
  });

  it("returns null for non-decision tools", () => {
    const entry = buildToolMetaCoherenceEntry({
      toolName: "read",
      meta: "src/foo.ts",
      now: 5000,
    });
    expect(entry).toBeNull();
  });
});

describe("buildToolCallCoherenceEntry", () => {
  it("populates verb=changed with subject from params", () => {
    const entry = buildToolCallCoherenceEntry({
      toolName: "edit",
      toolParams: { path: "src/bar.ts" },
      now: 5000,
    });
    expect(entry).not.toBeNull();
    expect(entry!.verb).toBe(EventVerb.CHANGED);
    expect(entry!.subject).toBe("src/bar.ts");
    expect(entry!.outcome).toBe("ok");
  });

  it("returns null for non-decision tools", () => {
    const entry = buildToolCallCoherenceEntry({
      toolName: "web_search",
      toolParams: { query: "test" },
      now: 5000,
    });
    expect(entry).toBeNull();
  });
});

describe("buildTaskTransitionEntry", () => {
  it("populates verb=decided for new task (started)", () => {
    const entry = buildTaskTransitionEntry({
      toTaskId: "task-1",
      toTaskTitle: "Debug auth",
      now: 5000,
    });
    expect(entry.verb).toBe(EventVerb.DECIDED);
    expect(entry.subject).toBe('task "Debug auth"');
    expect(entry.outcome).toBe("started");
    expect(entry.source).toBe("task_transition");
  });

  it("populates verb=decided for task switch (switched)", () => {
    const entry = buildTaskTransitionEntry({
      fromTaskId: "task-0",
      toTaskId: "task-1",
      toTaskTitle: "New task",
      now: 5000,
    });
    expect(entry.verb).toBe(EventVerb.DECIDED);
    expect(entry.outcome).toBe("switched");
  });
});

describe("buildModelSwitchEntry", () => {
  it("populates verb=decided with model as subject", () => {
    const entry = buildModelSwitchEntry({
      fromModel: "claude-3.5",
      toModel: "claude-3-haiku",
      reason: "fallback",
      now: 5000,
    });
    expect(entry.verb).toBe(EventVerb.DECIDED);
    expect(entry.subject).toBe("claude-3-haiku");
    expect(entry.outcome).toBe("fallback");
    expect(entry.source).toBe("model_switch");
  });
});

describe("buildSystemEventEntry", () => {
  it("builds a FAILED event", () => {
    const entry = buildSystemEventEntry({
      verb: EventVerb.FAILED,
      subject: "exec",
      outcome: "exit code 1",
      now: 5000,
    });
    expect(entry.verb).toBe(EventVerb.FAILED);
    expect(entry.subject).toBe("exec");
    expect(entry.outcome).toBe("exit code 1");
    expect(entry.source).toBe("tool_call");
    expect(entry.summary).toBe("FAILED exec → exit code 1");
  });

  it("builds a COMPACTED event", () => {
    const entry = buildSystemEventEntry({
      verb: EventVerb.COMPACTED,
      subject: "session",
      outcome: "auto-compacted",
      now: 5000,
    });
    expect(entry.verb).toBe(EventVerb.COMPACTED);
    expect(entry.source).toBe("compaction");
  });

  it("builds a BLOCKED event", () => {
    const entry = buildSystemEventEntry({
      verb: EventVerb.BLOCKED,
      subject: "context",
      outcome: "overflow",
      now: 5000,
    });
    expect(entry.verb).toBe(EventVerb.BLOCKED);
    expect(entry.source).toBe("session_reset");
  });

  it("builds a REJECTED event", () => {
    const entry = buildSystemEventEntry({
      verb: EventVerb.REJECTED,
      subject: "session",
      outcome: "user reset",
      now: 5000,
    });
    expect(entry.verb).toBe(EventVerb.REJECTED);
    expect(entry.source).toBe("session_reset");
  });
});

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

describe("scoreEvent", () => {
  const now = 100_000;

  it("gives higher score to pinned events", () => {
    const entry: CoherenceEntry = {
      ts: now - 60_000,
      source: "tool_call",
      summary: "test",
      verb: EventVerb.CHANGED,
      subject: "file",
      outcome: "ok",
    };
    const scoreUnpinned = scoreEvent(entry, [], now);
    const scorePinned = scoreEvent(entry, [entry], now);
    expect(scorePinned).toBeGreaterThan(scoreUnpinned);
    expect(scorePinned - scoreUnpinned).toBeCloseTo(10, 0);
  });

  it("gives higher score to recent events", () => {
    const recent: CoherenceEntry = {
      ts: now - 60_000, // 1 minute ago
      source: "tool_call",
      summary: "recent",
      verb: EventVerb.CHANGED,
      subject: "a",
      outcome: "ok",
    };
    const old: CoherenceEntry = {
      ts: now - 3_600_000, // 60 minutes ago
      source: "tool_call",
      summary: "old",
      verb: EventVerb.CHANGED,
      subject: "b",
      outcome: "ok",
    };
    expect(scoreEvent(recent, [], now)).toBeGreaterThan(scoreEvent(old, [], now));
  });

  it("gives bonus to high-signal verbs", () => {
    const base: CoherenceEntry = {
      ts: now,
      source: "tool_call",
      summary: "test",
      subject: "x",
      outcome: "ok",
    };
    const changed = { ...base, verb: EventVerb.CHANGED as const };
    const failed = { ...base, verb: EventVerb.FAILED as const };
    const blocked = { ...base, verb: EventVerb.BLOCKED as const };

    const scoreChanged = scoreEvent(changed, [], now);
    const scoreFailed = scoreEvent(failed, [], now);
    const scoreBlocked = scoreEvent(blocked, [], now);

    expect(scoreFailed).toBeGreaterThan(scoreChanged);
    expect(scoreBlocked).toBeGreaterThan(scoreChanged);
  });
});

// ---------------------------------------------------------------------------
// Selection + Injection
// ---------------------------------------------------------------------------

describe("selectEventsForInjection", () => {
  it("returns empty for fresh state (self-gating)", () => {
    const state = createInitialCoherenceLog();
    expect(selectEventsForInjection(state)).toEqual([]);
  });

  it("returns empty when all entries are legacy (no verb)", () => {
    const state: CoherenceLogState = {
      entries: [
        { ts: 1000, source: "tool_call", summary: "Edit: foo.ts" },
        { ts: 2000, source: "tool_call", summary: "Write: bar.ts" },
        { ts: 3000, source: "tool_call", summary: "Exec: npm test" },
      ],
      pinned: [],
    };
    expect(selectEventsForInjection(state)).toEqual([]);
  });

  it("selects structured events sorted by score", () => {
    const now = 100_000;
    const state: CoherenceLogState = {
      entries: [
        {
          ts: now - 5000,
          source: "tool_call",
          summary: "test1",
          verb: EventVerb.CHANGED,
          subject: "a",
          outcome: "ok",
        },
        {
          ts: now - 1000,
          source: "tool_call",
          summary: "test2",
          verb: EventVerb.FAILED,
          subject: "b",
          outcome: "error",
        },
      ],
      pinned: [],
    };
    const selected = selectEventsForInjection(state, now);
    expect(selected).toHaveLength(2);
    // FAILED should come first (higher verb bonus)
    expect(selected[0]!.verb).toBe(EventVerb.FAILED);
    expect(selected[1]!.verb).toBe(EventVerb.CHANGED);
  });

  it("caps at MAX_EVENT_LINES (8)", () => {
    const now = 100_000;
    const entries: CoherenceEntry[] = [];
    for (let i = 0; i < 15; i++) {
      entries.push({
        ts: now - i * 1000,
        source: "tool_call",
        summary: `test${i}`,
        verb: EventVerb.CHANGED,
        subject: `file${i}`,
        outcome: "ok",
      });
    }
    const state: CoherenceLogState = { entries, pinned: [] };
    const selected = selectEventsForInjection(state, now);
    expect(selected).toHaveLength(8);
  });

  it("deduplicates entries present in both pinned and FIFO", () => {
    const now = 100_000;
    const entry: CoherenceEntry = {
      ts: now - 1000,
      source: "tool_call",
      summary: "important",
      verb: EventVerb.DECIDED,
      subject: "plan",
      outcome: "approved",
    };
    const state: CoherenceLogState = {
      entries: [entry],
      pinned: [entry],
    };
    const selected = selectEventsForInjection(state, now);
    expect(selected).toHaveLength(1);
  });
});

describe("formatEventMemoryInjection", () => {
  it("returns null for empty events", () => {
    expect(formatEventMemoryInjection([])).toBeNull();
  });

  it("formats events with verb, subject, outcome, and age", () => {
    const now = 100_000;
    const events: CoherenceEntry[] = [
      {
        ts: now - 180_000, // 3 minutes ago
        source: "tool_call",
        summary: "test",
        verb: EventVerb.FAILED,
        subject: 'exec "npm test"',
        outcome: "exit code 1",
      },
    ];
    const result = formatEventMemoryInjection(events, now);
    expect(result).not.toBeNull();
    expect(result).toContain("## Event Memory");
    expect(result).toContain('FAILED exec "npm test" → exit code 1 (3m ago)');
    expect(result).toContain('What failed: exec "npm test".');
  });

  it("includes associative recall footer with multiple verbs", () => {
    const now = 100_000;
    const events: CoherenceEntry[] = [
      {
        ts: now - 60_000,
        source: "tool_call",
        summary: "t1",
        verb: EventVerb.FAILED,
        subject: "exec",
        outcome: "error",
      },
      {
        ts: now - 120_000,
        source: "tool_call",
        summary: "t2",
        verb: EventVerb.DECIDED,
        subject: "plan A",
        outcome: "approved",
      },
    ];
    const result = formatEventMemoryInjection(events, now)!;
    expect(result).toContain("What failed: exec");
    expect(result).toContain("What was decided: plan A");
  });
});

// ---------------------------------------------------------------------------
// CLI Status
// ---------------------------------------------------------------------------

describe("formatEventMemoryStatus", () => {
  it("reports no structured events for legacy-only state", () => {
    const state: CoherenceLogState = {
      entries: [{ ts: 1000, source: "tool_call", summary: "legacy" }],
      pinned: [],
    };
    expect(formatEventMemoryStatus(state)).toContain("no structured events");
  });

  it("shows verb distribution for structured events", () => {
    const now = 100_000;
    const state: CoherenceLogState = {
      entries: [
        {
          ts: now,
          source: "tool_call",
          summary: "a",
          verb: EventVerb.CHANGED,
          subject: "x",
          outcome: "ok",
        },
        {
          ts: now,
          source: "tool_call",
          summary: "b",
          verb: EventVerb.FAILED,
          subject: "y",
          outcome: "err",
        },
        {
          ts: now,
          source: "tool_call",
          summary: "c",
          verb: EventVerb.CHANGED,
          subject: "z",
          outcome: "ok",
        },
      ],
      pinned: [],
    };
    const result = formatEventMemoryStatus(state, now);
    expect(result).toContain("3 structured events");
    expect(result).toContain("changed=2");
    expect(result).toContain("failed=1");
  });
});

// ---------------------------------------------------------------------------
// Backward compatibility
// ---------------------------------------------------------------------------

describe("backward compatibility", () => {
  it("legacy entries without verb coexist with structured entries", () => {
    const now = 100_000;
    const state: CoherenceLogState = {
      entries: [
        { ts: now - 5000, source: "tool_call", summary: "Legacy: edit foo.ts" },
        {
          ts: now - 1000,
          source: "tool_call",
          summary: "new",
          verb: EventVerb.CHANGED,
          subject: "bar.ts",
          outcome: "ok",
        },
      ],
      pinned: [],
    };
    // selectEventsForInjection should only pick up the structured one
    const selected = selectEventsForInjection(state, now);
    expect(selected).toHaveLength(1);
    expect(selected[0]!.verb).toBe(EventVerb.CHANGED);
  });
});
