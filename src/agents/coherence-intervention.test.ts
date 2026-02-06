import { describe, expect, it } from "vitest";
import {
  buildCoherenceIntervention,
  resolveCoherenceInterventionForSession,
} from "./coherence-intervention.js";
import { type CoherenceEntry, type CoherenceLogState, EventVerb } from "./coherence-log.js";
import type { SessionEntry } from "../config/sessions/types.js";

// ---------------------------------------------------------------------------
// buildCoherenceIntervention — unit tests
// ---------------------------------------------------------------------------

describe("buildCoherenceIntervention", () => {
  it("returns null for empty state", () => {
    const state: CoherenceLogState = { entries: [], pinned: [] };
    expect(buildCoherenceIntervention(state)).toBeNull();
  });

  it("returns null when entries < MIN_ENTRIES_FOR_INTERVENTION (3) and no pinned", () => {
    const state: CoherenceLogState = {
      entries: [
        { ts: 1000, source: "tool_call", summary: "Edit: foo.ts" },
        { ts: 2000, source: "tool_call", summary: "Write: bar.ts" },
      ],
      pinned: [],
    };
    expect(buildCoherenceIntervention(state)).toBeNull();
  });

  it("returns intervention when pinned entries exist (even with 0 FIFO entries)", () => {
    const state: CoherenceLogState = {
      entries: [],
      pinned: [{ ts: 1000, source: "tool_call", summary: "Use TypeScript strict mode" }],
    };
    const result = buildCoherenceIntervention(state);
    expect(result).not.toBeNull();
    expect(result!.text).toContain("## Recent Decisions");
    expect(result!.text).toContain("Committed: Use TypeScript strict mode");
  });

  it("returns intervention when entries >= 3", () => {
    const state: CoherenceLogState = {
      entries: [
        { ts: 1000, source: "tool_call", summary: "Edit: a.ts" },
        { ts: 2000, source: "tool_call", summary: "Edit: b.ts" },
        { ts: 3000, source: "tool_call", summary: "Exec: npm test" },
      ],
      pinned: [],
    };
    const result = buildCoherenceIntervention(state);
    expect(result).not.toBeNull();
    expect(result!.text).toContain("Recent: Edit: a.ts");
    expect(result!.text).toContain("Before contradicting");
  });
});

// ---------------------------------------------------------------------------
// resolveCoherenceInterventionForSession — integration tests
// ---------------------------------------------------------------------------

describe("resolveCoherenceInterventionForSession", () => {
  it("returns null for undefined entry", () => {
    expect(resolveCoherenceInterventionForSession(undefined)).toBeNull();
  });

  it("returns null for session with no coherence/failure data", () => {
    const entry = {
      sessionId: "s1",
      updatedAt: Date.now(),
    } as SessionEntry;
    expect(resolveCoherenceInterventionForSession(entry)).toBeNull();
  });

  it("includes event memory section when structured events exist", () => {
    const now = Date.now();
    const structuredEntries: CoherenceEntry[] = [
      {
        ts: now - 60_000,
        source: "tool_call",
        summary: "Edit: src/foo.ts",
        verb: EventVerb.CHANGED,
        subject: "src/foo.ts",
        outcome: "ok",
      },
      {
        ts: now - 30_000,
        source: "tool_call",
        summary: "FAILED exec → exit code 1",
        verb: EventVerb.FAILED,
        subject: "exec",
        outcome: "exit code 1",
      },
      {
        ts: now - 20_000,
        source: "task_transition",
        summary: 'Started task "Debug auth"',
        verb: EventVerb.DECIDED,
        subject: 'task "Debug auth"',
        outcome: "started",
      },
    ];

    const entry = {
      sessionId: "s1",
      updatedAt: now,
      coherenceEntries: structuredEntries,
      coherencePinned: [],
    } as SessionEntry;

    const result = resolveCoherenceInterventionForSession(entry);
    expect(result).not.toBeNull();
    // Should contain both Recent Decisions and Event Memory
    expect(result!.text).toContain("## Recent Decisions");
    expect(result!.text).toContain("## Event Memory");
    expect(result!.text).toContain("FAILED exec");
    expect(result!.text).toContain("CHANGED src/foo.ts");
  });

  it("omits event memory section when only legacy entries exist", () => {
    const now = Date.now();
    const legacyEntries: CoherenceEntry[] = [
      { ts: now - 60_000, source: "tool_call", summary: "Edit: a.ts" },
      { ts: now - 50_000, source: "tool_call", summary: "Edit: b.ts" },
      { ts: now - 40_000, source: "tool_call", summary: "Exec: npm test" },
    ];

    const entry = {
      sessionId: "s1",
      updatedAt: now,
      coherenceEntries: legacyEntries,
      coherencePinned: [],
    } as SessionEntry;

    const result = resolveCoherenceInterventionForSession(entry);
    expect(result).not.toBeNull();
    expect(result!.text).toContain("## Recent Decisions");
    expect(result!.text).not.toContain("## Event Memory");
  });

  it("event memory integrates correctly alongside tool avoidance and failure memory", () => {
    const now = Date.now();
    const structuredEntries: CoherenceEntry[] = [
      {
        ts: now - 10_000,
        source: "tool_call",
        summary: "FAILED exec → timeout",
        verb: EventVerb.FAILED,
        subject: "exec",
        outcome: "timeout",
      },
      {
        ts: now - 8_000,
        source: "tool_call",
        summary: "Edit: src/fix.ts",
        verb: EventVerb.CHANGED,
        subject: "src/fix.ts",
        outcome: "ok",
      },
      {
        ts: now - 5_000,
        source: "tool_call",
        summary: "Edit: src/bar.ts",
        verb: EventVerb.CHANGED,
        subject: "src/bar.ts",
        outcome: "ok",
      },
    ];

    const entry = {
      sessionId: "s1",
      updatedAt: now,
      coherenceEntries: structuredEntries,
      coherencePinned: [],
      // Include tool failures to verify co-existence
      toolFailures: [
        {
          toolName: "exec",
          consecutiveFailures: 3,
          totalFailures: 5,
          lastFailureTs: now - 10_000,
          lastError: "timeout",
        },
      ],
      failureSignatures: [
        {
          toolName: "exec",
          pattern: "timeout",
          count: 3,
          firstTs: now - 60_000,
          lastTs: now - 10_000,
        },
      ],
    } as SessionEntry;

    const result = resolveCoherenceInterventionForSession(entry);
    expect(result).not.toBeNull();

    const text = result!.text;
    // Should have multiple sections
    expect(text).toContain("## Recent Decisions");
    expect(text).toContain("## Event Memory");
    // The sections should be separated by double newlines
    const sections = text.split("\n\n");
    expect(sections.length).toBeGreaterThanOrEqual(2);
  });

  // -----------------------------------------------------------------------
  // RSC v3.1: Cross-session promoted event injection
  // -----------------------------------------------------------------------

  it("includes cross-session memory when opts with promoted events are provided", () => {
    const now = Date.now();
    const entry = {
      sessionId: "s1",
      updatedAt: now,
      coherenceEntries: [
        { ts: now - 10_000, source: "tool_call" as const, summary: "Edit: a.ts" },
        { ts: now - 8_000, source: "tool_call" as const, summary: "Edit: b.ts" },
        { ts: now - 5_000, source: "tool_call" as const, summary: "Exec: npm test" },
      ],
      coherencePinned: [],
      promotedEvents: [
        {
          verb: EventVerb.FAILED,
          subject: "npm test",
          outcome: "timeout",
          occurrences: 4,
          firstSeenTs: now - 86_400_000 * 3,
          lastSeenTs: now - 3600_000,
          sourceSessionKeys: ["s1", "s2", "s3", "s4"],
          retireAfterTs: now + 86_400_000 * 14,
        },
      ],
    } as SessionEntry;

    const sessionStore = { "agent:main": entry };
    const result = resolveCoherenceInterventionForSession(entry, {
      sessionStore,
      sessionKey: "agent:main",
    });

    expect(result).not.toBeNull();
    expect(result!.text).toContain("## Cross-Session Memory");
    expect(result!.text).toContain("FAILED");
    expect(result!.text).toContain("npm test");
    expect(result!.text).toContain("timeout");
  });

  it("resolves promoted events from parent session", () => {
    const now = Date.now();
    const childEntry = {
      sessionId: "child1",
      updatedAt: now,
      coherenceEntries: [
        { ts: now - 10_000, source: "tool_call" as const, summary: "Edit: a.ts" },
        { ts: now - 8_000, source: "tool_call" as const, summary: "Edit: b.ts" },
        { ts: now - 5_000, source: "tool_call" as const, summary: "Exec: npm test" },
      ],
      coherencePinned: [],
    } as SessionEntry;

    const parentEntry = {
      sessionId: "parent1",
      updatedAt: now,
      promotedEvents: [
        {
          verb: EventVerb.DECIDED,
          subject: "use vitest",
          outcome: "switched",
          occurrences: 3,
          firstSeenTs: now - 86_400_000 * 5,
          lastSeenTs: now - 7200_000,
          sourceSessionKeys: ["s1", "s2", "s3"],
          retireAfterTs: now + 86_400_000 * 14,
        },
      ],
    } as SessionEntry;

    const sessionStore: Record<string, SessionEntry> = {
      "agent:main": parentEntry,
      "agent:main:topic:99": childEntry,
    };

    const result = resolveCoherenceInterventionForSession(childEntry, {
      sessionStore,
      sessionKey: "agent:main:topic:99",
    });

    expect(result).not.toBeNull();
    expect(result!.text).toContain("## Cross-Session Memory");
    expect(result!.text).toContain("DECIDED");
    expect(result!.text).toContain("use vitest");
  });

  it("omits cross-session section when opts not provided (backward compat)", () => {
    const now = Date.now();
    const entry = {
      sessionId: "s1",
      updatedAt: now,
      coherenceEntries: [
        { ts: now - 10_000, source: "tool_call" as const, summary: "Edit: a.ts" },
        { ts: now - 8_000, source: "tool_call" as const, summary: "Edit: b.ts" },
        { ts: now - 5_000, source: "tool_call" as const, summary: "Exec: npm test" },
      ],
      coherencePinned: [],
      promotedEvents: [
        {
          verb: EventVerb.FAILED,
          subject: "npm test",
          outcome: "timeout",
          occurrences: 4,
          firstSeenTs: now - 86_400_000 * 3,
          lastSeenTs: now - 3600_000,
          sourceSessionKeys: ["s1", "s2", "s3", "s4"],
          retireAfterTs: now + 86_400_000 * 14,
        },
      ],
    } as SessionEntry;

    // Call without opts — should not include cross-session memory
    const result = resolveCoherenceInterventionForSession(entry);
    expect(result).not.toBeNull();
    expect(result!.text).not.toContain("## Cross-Session Memory");
  });

  it("prunes retired promoted events from injection", () => {
    const now = Date.now();
    const entry = {
      sessionId: "s1",
      updatedAt: now,
      coherenceEntries: [
        { ts: now - 10_000, source: "tool_call" as const, summary: "Edit: a.ts" },
        { ts: now - 8_000, source: "tool_call" as const, summary: "Edit: b.ts" },
        { ts: now - 5_000, source: "tool_call" as const, summary: "Exec: npm test" },
      ],
      coherencePinned: [],
      promotedEvents: [
        {
          verb: EventVerb.FAILED,
          subject: "npm test",
          outcome: "timeout",
          occurrences: 4,
          firstSeenTs: now - 86_400_000 * 30,
          lastSeenTs: now - 86_400_000 * 20,
          sourceSessionKeys: ["s1", "s2", "s3", "s4"],
          retireAfterTs: now - 1000, // already expired
        },
      ],
    } as SessionEntry;

    const sessionStore = { "agent:main": entry };
    const result = resolveCoherenceInterventionForSession(entry, {
      sessionStore,
      sessionKey: "agent:main",
    });

    // Should not include cross-session memory (event is expired)
    expect(result).not.toBeNull();
    expect(result!.text).not.toContain("## Cross-Session Memory");
  });
});
