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
  VERB_TAXONOMY_VERSION,
  analyzeVerbTaxonomy,
  formatVerbTaxonomyReport,
  computeTrustSignals,
  formatTrustStatus,
  evaluatePromotionCandidates,
  pruneRetiredPromotedEvents,
  formatPromotedEventsInjection,
  formatPromotedEventsStatus,
  isUserCorrection,
  buildUserCorrectionEntry,
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

// ===========================================================================
// RSC v3.1 — Verb Taxonomy Analysis
// ===========================================================================

describe("VERB_TAXONOMY_VERSION", () => {
  it("is 1 for the initial taxonomy", () => {
    expect(VERB_TAXONOMY_VERSION).toBe(1);
  });
});

describe("analyzeVerbTaxonomy", () => {
  it("returns empty report for no structured events", () => {
    const report = analyzeVerbTaxonomy([{ ts: 1000, source: "tool_call", summary: "legacy" }]);
    expect(report.analyses).toHaveLength(0);
    expect(report.suggestions).toHaveLength(0);
  });

  it("computes verb frequency and entropy", () => {
    const entries: CoherenceEntry[] = [
      {
        ts: 1000,
        source: "tool_call",
        summary: "a",
        verb: EventVerb.CHANGED,
        subject: "file1",
        outcome: "ok",
      },
      {
        ts: 2000,
        source: "tool_call",
        summary: "b",
        verb: EventVerb.CHANGED,
        subject: "file2",
        outcome: "ok",
      },
      {
        ts: 3000,
        source: "tool_call",
        summary: "c",
        verb: EventVerb.CHANGED,
        subject: "file3",
        outcome: "ok",
      },
      {
        ts: 4000,
        source: "tool_call",
        summary: "d",
        verb: EventVerb.FAILED,
        subject: "exec",
        outcome: "error",
      },
    ];
    const report = analyzeVerbTaxonomy(entries);
    expect(report.analyses).toHaveLength(2);

    const changed = report.analyses.find((a) => a.verb === "changed");
    expect(changed).toBeDefined();
    expect(changed!.count).toBe(3);
    // 3 unique subjects → entropy = log2(3) ≈ 1.58
    expect(changed!.subjectEntropy).toBeGreaterThan(1);
    // all outcomes "ok" → entropy ≈ 0
    expect(changed!.outcomeEntropy).toBeCloseTo(0, 1);
  });

  it("detects too-broad verb when frequency >60% and entropy >2.0", () => {
    const entries: CoherenceEntry[] = [];
    // 10 CHANGED events with 8 unique subjects (high entropy)
    for (let i = 0; i < 10; i++) {
      entries.push({
        ts: i * 1000,
        source: "tool_call",
        summary: `e${i}`,
        verb: EventVerb.CHANGED,
        subject: `subject-${i % 8}`,
        outcome: "ok",
      });
    }
    // 2 FAILED events
    entries.push(
      {
        ts: 11000,
        source: "tool_call",
        summary: "f1",
        verb: EventVerb.FAILED,
        subject: "exec",
        outcome: "err",
      },
      {
        ts: 12000,
        source: "tool_call",
        summary: "f2",
        verb: EventVerb.FAILED,
        subject: "exec",
        outcome: "err",
      },
    );

    const report = analyzeVerbTaxonomy(entries);
    const changed = report.analyses.find((a) => a.verb === "changed");
    expect(changed?.diagnostic).toBe("too-broad");
    expect(report.suggestions.some((s) => s.kind === "split")).toBe(true);
  });

  it("detects anomalous CHANGED outcomes suggesting missing verb", () => {
    const entries: CoherenceEntry[] = [];
    // 6 CHANGED events with "reverted" outcome
    for (let i = 0; i < 6; i++) {
      entries.push({
        ts: i * 1000,
        source: "tool_call",
        summary: `r${i}`,
        verb: EventVerb.CHANGED,
        subject: `file${i}`,
        outcome: "reverted from backup",
      });
    }
    const report = analyzeVerbTaxonomy(entries);
    expect(
      report.suggestions.some((s) => s.kind === "add" && s.description.includes("revert")),
    ).toBe(true);
  });

  it("detects retry pattern (FAILED → same-subject CHANGED)", () => {
    const entries: CoherenceEntry[] = [];
    // 6 retry pairs
    for (let i = 0; i < 6; i++) {
      entries.push(
        {
          ts: i * 3000,
          source: "tool_call",
          summary: `f${i}`,
          verb: EventVerb.FAILED,
          subject: "exec npm test",
          outcome: "fail",
        },
        {
          ts: i * 3000 + 1000,
          source: "tool_call",
          summary: `r${i}`,
          verb: EventVerb.CHANGED,
          subject: "exec npm test",
          outcome: "ok",
        },
      );
    }
    const report = analyzeVerbTaxonomy(entries);
    expect(
      report.suggestions.some((s) => s.kind === "add" && s.description.includes("RETRIED")),
    ).toBe(true);
  });
});

describe("formatVerbTaxonomyReport", () => {
  it("reports no events when empty", () => {
    const result = formatVerbTaxonomyReport({ analyses: [], coOccurrences: [], suggestions: [] });
    expect(result).toContain("no structured events");
  });

  it("formats analyses with diagnostics", () => {
    const report = analyzeVerbTaxonomy([
      {
        ts: 1000,
        source: "tool_call",
        summary: "a",
        verb: EventVerb.CHANGED,
        subject: "f1",
        outcome: "ok",
      },
      {
        ts: 2000,
        source: "tool_call",
        summary: "b",
        verb: EventVerb.FAILED,
        subject: "exec",
        outcome: "err",
      },
    ]);
    const result = formatVerbTaxonomyReport(report);
    expect(result).toContain("Verb Taxonomy Health");
    expect(result).toContain("changed");
    expect(result).toContain("failed");
  });
});

// ===========================================================================
// RSC v3.1 — Trust Accumulation
// ===========================================================================

describe("computeTrustSignals", () => {
  it("returns tier=new for fewer than 10 events", () => {
    const events: CoherenceEntry[] = [
      {
        ts: 1000,
        source: "tool_call",
        summary: "a",
        verb: EventVerb.CHANGED,
        subject: "f",
        outcome: "ok",
      },
    ];
    const signals = computeTrustSignals(events);
    expect(signals.tier).toBe("new");
    expect(signals.totalEvents).toBe(1);
  });

  it("counts decisions held (DECIDED not followed by REJECTED)", () => {
    const events: CoherenceEntry[] = [];
    // 5 DECIDED events without any REJECTED
    for (let i = 0; i < 5; i++) {
      events.push({
        ts: i * 1000,
        source: "task_transition",
        summary: `d${i}`,
        verb: EventVerb.DECIDED,
        subject: `task-${i}`,
        outcome: "started",
      });
    }
    // 5 CHANGED to get to 10 total
    for (let i = 0; i < 5; i++) {
      events.push({
        ts: (i + 10) * 1000,
        source: "tool_call",
        summary: `c${i}`,
        verb: EventVerb.CHANGED,
        subject: `file-${i}`,
        outcome: "ok",
      });
    }
    const signals = computeTrustSignals(events);
    expect(signals.decisionsHeld).toBe(5);
    expect(signals.contradictions).toBe(0);
    expect(signals.tier).toBe("emerging");
  });

  it("counts contradictions (DECIDED then REJECTED on same subject)", () => {
    const events: CoherenceEntry[] = [
      {
        ts: 1000,
        source: "task_transition",
        summary: "d",
        verb: EventVerb.DECIDED,
        subject: "plan A",
        outcome: "started",
      },
      {
        ts: 2000,
        source: "session_reset",
        summary: "r",
        verb: EventVerb.REJECTED,
        subject: "plan A",
        outcome: "user reset",
      },
    ];
    const signals = computeTrustSignals(events);
    expect(signals.contradictions).toBe(1);
    expect(signals.decisionsHeld).toBe(0);
  });

  it("counts failures recovered (FAILED → same-subject CHANGED)", () => {
    const events: CoherenceEntry[] = [
      {
        ts: 1000,
        source: "tool_call",
        summary: "f",
        verb: EventVerb.FAILED,
        subject: "npm test",
        outcome: "fail",
      },
      {
        ts: 2000,
        source: "tool_call",
        summary: "c",
        verb: EventVerb.CHANGED,
        subject: "npm test",
        outcome: "ok",
      },
    ];
    const signals = computeTrustSignals(events);
    expect(signals.failuresRecovered).toBe(1);
  });

  it("counts repeated failures", () => {
    const events: CoherenceEntry[] = [];
    // Same failure 4 times
    for (let i = 0; i < 4; i++) {
      events.push({
        ts: i * 1000,
        source: "tool_call",
        summary: `f${i}`,
        verb: EventVerb.FAILED,
        subject: "npm test",
        outcome: "timeout",
      });
    }
    const signals = computeTrustSignals(events);
    expect(signals.repeatedFailures).toBe(1);
  });

  it("reaches established tier with enough positive signals", () => {
    const events: CoherenceEntry[] = [];
    // 15 held decisions
    for (let i = 0; i < 15; i++) {
      events.push({
        ts: i * 1000,
        source: "task_transition",
        summary: `d${i}`,
        verb: EventVerb.DECIDED,
        subject: `task-${i}`,
        outcome: "started",
      });
    }
    // 5 recovered failures
    for (let i = 0; i < 5; i++) {
      events.push(
        {
          ts: (20 + i * 2) * 1000,
          source: "tool_call",
          summary: `f${i}`,
          verb: EventVerb.FAILED,
          subject: `tool-${i}`,
          outcome: "err",
        },
        {
          ts: (21 + i * 2) * 1000,
          source: "tool_call",
          summary: `r${i}`,
          verb: EventVerb.CHANGED,
          subject: `tool-${i}`,
          outcome: "ok",
        },
      );
    }
    // 5 more CHANGED to pad total
    for (let i = 0; i < 5; i++) {
      events.push({
        ts: (40 + i) * 1000,
        source: "tool_call",
        summary: `c${i}`,
        verb: EventVerb.CHANGED,
        subject: `file-${i}`,
        outcome: "ok",
      });
    }
    const signals = computeTrustSignals(events);
    expect(signals.tier).toBe("established");
    expect(signals.decisionsHeld).toBe(15);
    expect(signals.failuresRecovered).toBe(5);
  });
});

describe("formatTrustStatus", () => {
  it("formats trust tier and signal counts", () => {
    const signals = computeTrustSignals([
      {
        ts: 1000,
        source: "tool_call",
        summary: "a",
        verb: EventVerb.CHANGED,
        subject: "f",
        outcome: "ok",
      },
    ]);
    const result = formatTrustStatus(signals);
    expect(result).toContain("Trust: new");
    expect(result).toContain("Positive:");
    expect(result).toContain("Negative:");
  });
});

// ===========================================================================
// RSC v3.1 — Cross-Session Event Promotion
// ===========================================================================

describe("evaluatePromotionCandidates", () => {
  it("creates a candidate from a promotion-eligible event", () => {
    const events: CoherenceEntry[] = [
      {
        ts: 1000,
        source: "tool_call",
        summary: "f",
        verb: EventVerb.FAILED,
        subject: "exec",
        outcome: "timeout",
      },
    ];
    const { candidates, promoted } = evaluatePromotionCandidates({
      sessionKey: "s1",
      events,
      pinned: [],
      existingCandidates: [],
      existingPromoted: [],
      now: 2000,
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.verb).toBe(EventVerb.FAILED);
    expect(candidates[0]!.seenInSessions).toEqual(["s1"]);
    expect(promoted).toHaveLength(0);
  });

  it("ignores non-eligible verbs (CHANGED)", () => {
    const events: CoherenceEntry[] = [
      {
        ts: 1000,
        source: "tool_call",
        summary: "c",
        verb: EventVerb.CHANGED,
        subject: "file.ts",
        outcome: "ok",
      },
    ];
    const { candidates } = evaluatePromotionCandidates({
      sessionKey: "s1",
      events,
      pinned: [],
      existingCandidates: [],
      existingPromoted: [],
      now: 2000,
    });
    expect(candidates).toHaveLength(0);
  });

  it("promotes after reaching 3-session threshold", () => {
    const now = Date.now();
    const existingCandidate = {
      verb: EventVerb.FAILED as const,
      subject: "exec",
      outcome: "timeout",
      seenInSessions: ["s1", "s2"],
      seenTimestamps: [now - 100_000, now - 50_000],
    };
    const events: CoherenceEntry[] = [
      {
        ts: now,
        source: "tool_call",
        summary: "f",
        verb: EventVerb.FAILED,
        subject: "exec",
        outcome: "timeout",
      },
    ];
    const { candidates, promoted } = evaluatePromotionCandidates({
      sessionKey: "s3",
      events,
      pinned: [],
      existingCandidates: [existingCandidate],
      existingPromoted: [],
      now,
    });
    expect(promoted).toHaveLength(1);
    expect(promoted[0]!.verb).toBe(EventVerb.FAILED);
    expect(promoted[0]!.occurrences).toBe(3);
    // Candidate should be removed after promotion
    expect(candidates.find((c) => c.subject === "exec")).toBeUndefined();
  });

  it("reinforces already-promoted events", () => {
    const now = Date.now();
    const existingPromoted = {
      verb: EventVerb.FAILED as const,
      subject: "exec",
      outcome: "timeout",
      occurrences: 3,
      firstSeenTs: now - 200_000,
      lastSeenTs: now - 100_000,
      sourceSessionKeys: ["s1", "s2", "s3"],
      retireAfterTs: now + 1_000_000,
    };
    const events: CoherenceEntry[] = [
      {
        ts: now,
        source: "tool_call",
        summary: "f",
        verb: EventVerb.FAILED,
        subject: "exec",
        outcome: "timeout",
      },
    ];
    const { promoted } = evaluatePromotionCandidates({
      sessionKey: "s4",
      events,
      pinned: [],
      existingCandidates: [],
      existingPromoted: [existingPromoted],
      now,
    });
    expect(promoted).toHaveLength(1);
    expect(promoted[0]!.occurrences).toBe(4);
    expect(promoted[0]!.sourceSessionKeys).toContain("s4");
  });

  it("promotes pinned events at lower threshold (2 sessions)", () => {
    const now = Date.now();
    const existingCandidate = {
      verb: EventVerb.DECIDED as const,
      subject: "use vitest",
      outcome: "switched",
      seenInSessions: ["s1"],
      seenTimestamps: [now - 50_000],
    };
    const events: CoherenceEntry[] = [
      {
        ts: now,
        source: "task_transition",
        summary: "d",
        verb: EventVerb.DECIDED,
        subject: "use vitest",
        outcome: "switched",
      },
    ];
    const pinned: CoherenceEntry[] = [
      {
        ts: now,
        source: "task_transition",
        summary: "d",
        verb: EventVerb.DECIDED,
        subject: "use vitest",
        outcome: "switched",
      },
    ];
    const { promoted } = evaluatePromotionCandidates({
      sessionKey: "s2",
      events,
      pinned,
      existingCandidates: [existingCandidate],
      existingPromoted: [],
      now,
    });
    expect(promoted).toHaveLength(1);
    expect(promoted[0]!.occurrences).toBe(2);
  });
});

describe("pruneRetiredPromotedEvents", () => {
  it("removes events past retireAfterTs", () => {
    const now = Date.now();
    const events = [
      {
        verb: EventVerb.FAILED as const,
        subject: "a",
        outcome: "err",
        occurrences: 3,
        firstSeenTs: 0,
        lastSeenTs: 0,
        sourceSessionKeys: [],
        retireAfterTs: now - 1000,
      },
      {
        verb: EventVerb.FAILED as const,
        subject: "b",
        outcome: "err",
        occurrences: 3,
        firstSeenTs: 0,
        lastSeenTs: 0,
        sourceSessionKeys: [],
        retireAfterTs: now + 1000,
      },
    ];
    const pruned = pruneRetiredPromotedEvents(events, now);
    expect(pruned).toHaveLength(1);
    expect(pruned[0]!.subject).toBe("b");
  });
});

describe("formatPromotedEventsInjection", () => {
  it("returns null when no active promoted events", () => {
    expect(formatPromotedEventsInjection([])).toBeNull();
  });

  it("formats promoted events with cross-session framing", () => {
    const now = Date.now();
    const events = [
      {
        verb: EventVerb.FAILED as const,
        subject: "npm test",
        outcome: "timeout",
        occurrences: 4,
        firstSeenTs: 0,
        lastSeenTs: now,
        sourceSessionKeys: ["s1", "s2", "s3", "s4"],
        retireAfterTs: now + 100_000,
      },
    ];
    const result = formatPromotedEventsInjection(events, now);
    expect(result).toContain("## Cross-Session Memory");
    expect(result).toContain("FAILED npm test → timeout (seen 4 times)");
  });

  it("caps at 3 lines", () => {
    const now = Date.now();
    const events = Array.from({ length: 5 }, (_, i) => ({
      verb: EventVerb.FAILED as const,
      subject: `tool-${i}`,
      outcome: "err",
      occurrences: 3,
      firstSeenTs: 0,
      lastSeenTs: now,
      sourceSessionKeys: ["s1", "s2", "s3"],
      retireAfterTs: now + 100_000,
    }));
    const result = formatPromotedEventsInjection(events, now)!;
    const lines = result.split("\n").filter((l) => l.startsWith("- "));
    expect(lines).toHaveLength(3);
  });
});

describe("formatPromotedEventsStatus", () => {
  it("reports no events when empty", () => {
    const result = formatPromotedEventsStatus([], []);
    expect(result).toContain("no promoted events");
  });

  it("shows promoted events and candidates", () => {
    const now = Date.now();
    const promoted = [
      {
        verb: EventVerb.FAILED as const,
        subject: "exec",
        outcome: "timeout",
        occurrences: 4,
        firstSeenTs: 0,
        lastSeenTs: now,
        sourceSessionKeys: ["s1"],
        retireAfterTs: now + 86_400_000,
      },
    ];
    const candidates = [
      {
        verb: EventVerb.DECIDED as const,
        subject: "use vitest",
        outcome: "switched",
        seenInSessions: ["s1", "s2"],
        seenTimestamps: [now - 1000, now],
      },
    ];
    const result = formatPromotedEventsStatus(promoted, candidates);
    expect(result).toContain("Promoted Events (1/10)");
    expect(result).toContain("FAILED exec");
    expect(result).toContain("across 1 sessions");
    expect(result).toContain("Promotion Candidates (1/30)");
    expect(result).toContain("DECIDED use vitest");
    expect(result).toContain("2/3 sessions toward promotion");
  });
});

// ---------------------------------------------------------------------------
// RSC v3.1-patch — isUserCorrection
// ---------------------------------------------------------------------------

describe("isUserCorrection", () => {
  it("detects simple negation", () => {
    expect(isUserCorrection("no, undo that")).toBe(true);
  });

  it("detects 'wrong'", () => {
    expect(isUserCorrection("that's wrong")).toBe(true);
  });

  it("detects 'actually'", () => {
    expect(isUserCorrection("actually, use the other approach")).toBe(true);
  });

  it("detects 'revert'", () => {
    expect(isUserCorrection("revert the last change")).toBe(true);
  });

  it("detects 'don't'", () => {
    expect(isUserCorrection("don't do that")).toBe(true);
  });

  it("detects 'never mind'", () => {
    expect(isUserCorrection("never mind")).toBe(true);
  });

  it("detects 'cancel'", () => {
    expect(isUserCorrection("cancel that")).toBe(true);
  });

  it("returns false for normal instructions", () => {
    expect(isUserCorrection("Please add the new component")).toBe(false);
  });

  it("returns false for long messages even with correction words", () => {
    const longMsg = "no ".repeat(100);
    expect(longMsg.length).toBeGreaterThan(200);
    expect(isUserCorrection(longMsg)).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isUserCorrection("")).toBe(false);
  });

  it("is case insensitive", () => {
    expect(isUserCorrection("NO, UNDO THAT")).toBe(true);
  });

  it("requires word boundaries (no false positives on 'notion' or 'cannot')", () => {
    expect(isUserCorrection("open notion")).toBe(false);
    expect(isUserCorrection("I cannot believe it worked")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// RSC v3.1-patch — buildUserCorrectionEntry
// ---------------------------------------------------------------------------

describe("buildUserCorrectionEntry", () => {
  it("builds a REJECTED entry with verb and subject", () => {
    const entry = buildUserCorrectionEntry({
      messagePreview: "no, undo that please",
      now: 1000,
    });
    expect(entry.verb).toBe(EventVerb.REJECTED);
    expect(entry.subject).toBe("user correction");
    expect(entry.outcome).toBe("no, undo that please");
    expect(entry.source).toBe("session_reset");
    expect(entry.ts).toBe(1000);
  });

  it("truncates long previews to 60 chars", () => {
    const long = "a".repeat(100);
    const entry = buildUserCorrectionEntry({ messagePreview: long, now: 1000 });
    expect(entry.outcome!.length).toBe(60);
  });

  it("includes taskId when provided", () => {
    const entry = buildUserCorrectionEntry({
      messagePreview: "wrong",
      taskId: "task-1",
      now: 1000,
    });
    expect(entry.taskId).toBe("task-1");
  });
});
