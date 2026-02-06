import { describe, expect, it } from "vitest";
import {
  type CapabilityEntry,
  type CapabilityReliability,
  computeCapabilityReliability,
  formatCapabilityInjection,
  formatCapabilityStatus,
  MAX_CAPABILITY_ENTRIES,
  resolveCapabilityLedger,
  resolveProactivityLevel,
  selectCapabilitiesForInjection,
  upsertCapability,
} from "./capability-ledger.js";
import { type CoherenceEntry, EventVerb } from "./coherence-log.js";

// ---------------------------------------------------------------------------
// upsertCapability
// ---------------------------------------------------------------------------

describe("upsertCapability", () => {
  it("creates a new entry with verifiedCount 1", () => {
    const result = upsertCapability([], "browser", "navigate to URL", 1000);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      toolName: "browser",
      how: "navigate to URL",
      lastVerifiedTs: 1000,
      verifiedCount: 1,
    });
  });

  it("increments count and updates timestamp for existing tool", () => {
    const existing: CapabilityEntry[] = [
      { toolName: "exec", how: "pnpm test", lastVerifiedTs: 1000, verifiedCount: 3 },
    ];
    const result = upsertCapability(existing, "exec", "pnpm test", 2000);
    expect(result).toHaveLength(1);
    expect(result[0]!.verifiedCount).toBe(4);
    expect(result[0]!.lastVerifiedTs).toBe(2000);
  });

  it("updates how only when new meta is longer", () => {
    const existing: CapabilityEntry[] = [
      { toolName: "exec", how: "pnpm test", lastVerifiedTs: 1000, verifiedCount: 1 },
    ];

    // Shorter meta → keep existing how
    const r1 = upsertCapability(existing, "exec", "npm", 2000);
    expect(r1[0]!.how).toBe("pnpm test");

    // Longer meta → update how
    const r2 = upsertCapability(existing, "exec", "pnpm test --coverage", 2000);
    expect(r2[0]!.how).toBe("pnpm test --coverage");
  });

  it("uses toolName as fallback when how is undefined", () => {
    const result = upsertCapability([], "read", undefined, 1000);
    expect(result[0]!.how).toBe("read");
  });

  it("evicts least-recently-verified when exceeding cap", () => {
    const entries: CapabilityEntry[] = [];
    for (let i = 0; i < MAX_CAPABILITY_ENTRIES; i++) {
      entries.push({
        toolName: `tool${i}`,
        how: `tool${i}`,
        lastVerifiedTs: i * 1000,
        verifiedCount: 1,
      });
    }
    // Add one more — should evict tool0 (lastVerifiedTs=0, the oldest)
    const result = upsertCapability(entries, "newTool", "new", 99_000);
    expect(result).toHaveLength(MAX_CAPABILITY_ENTRIES);
    expect(result.find((c) => c.toolName === "tool0")).toBeUndefined();
    expect(result.find((c) => c.toolName === "newTool")).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// resolveCapabilityLedger
// ---------------------------------------------------------------------------

describe("resolveCapabilityLedger", () => {
  it("returns empty array for undefined input", () => {
    expect(resolveCapabilityLedger({})).toEqual([]);
    expect(resolveCapabilityLedger({ capabilityLedger: undefined })).toEqual([]);
  });

  it("returns empty array for non-array input", () => {
    expect(resolveCapabilityLedger({ capabilityLedger: null as unknown as undefined })).toEqual([]);
  });

  it("passes through valid ledger under cap", () => {
    const ledger: CapabilityEntry[] = [
      { toolName: "exec", how: "pnpm test", lastVerifiedTs: 1000, verifiedCount: 5 },
    ];
    expect(resolveCapabilityLedger({ capabilityLedger: ledger })).toEqual(ledger);
  });

  it("caps at MAX_CAPABILITY_ENTRIES keeping most recent", () => {
    const oversized: CapabilityEntry[] = [];
    for (let i = 0; i < MAX_CAPABILITY_ENTRIES + 5; i++) {
      oversized.push({
        toolName: `tool${i}`,
        how: `tool${i}`,
        lastVerifiedTs: i * 1000,
        verifiedCount: 1,
      });
    }
    const result = resolveCapabilityLedger({ capabilityLedger: oversized });
    expect(result).toHaveLength(MAX_CAPABILITY_ENTRIES);
    // Should keep the most recently verified (highest ts)
    expect(result[0]!.lastVerifiedTs).toBe((MAX_CAPABILITY_ENTRIES + 4) * 1000);
  });
});

// ---------------------------------------------------------------------------
// selectCapabilitiesForInjection
// ---------------------------------------------------------------------------

describe("selectCapabilitiesForInjection", () => {
  it("returns empty array for empty input", () => {
    expect(selectCapabilitiesForInjection([])).toEqual([]);
  });

  it("sorts by verifiedCount desc, then lastVerifiedTs desc", () => {
    const entries: CapabilityEntry[] = [
      { toolName: "a", how: "a", lastVerifiedTs: 3000, verifiedCount: 1 },
      { toolName: "b", how: "b", lastVerifiedTs: 1000, verifiedCount: 5 },
      { toolName: "c", how: "c", lastVerifiedTs: 2000, verifiedCount: 5 },
    ];
    const result = selectCapabilitiesForInjection(entries);
    expect(result[0]!.toolName).toBe("c"); // count=5, ts=2000 (higher ts)
    expect(result[1]!.toolName).toBe("b"); // count=5, ts=1000
    expect(result[2]!.toolName).toBe("a"); // count=1
  });

  it("caps at maxLines", () => {
    const entries: CapabilityEntry[] = Array.from({ length: 15 }, (_, i) => ({
      toolName: `tool${i}`,
      how: `tool${i}`,
      lastVerifiedTs: i * 1000,
      verifiedCount: i,
    }));
    const result = selectCapabilitiesForInjection(entries, 3);
    expect(result).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// formatCapabilityInjection
// ---------------------------------------------------------------------------

describe("formatCapabilityInjection", () => {
  it("returns null for empty capabilities", () => {
    expect(formatCapabilityInjection([])).toBeNull();
  });

  it("includes CAN use prefix and verified count", () => {
    const entries: CapabilityEntry[] = [
      { toolName: "browser", how: "navigate to URL", lastVerifiedTs: 1000, verifiedCount: 5 },
    ];
    const result = formatCapabilityInjection(entries)!;
    expect(result).toContain("## Verified Capabilities");
    expect(result).toContain("CAN use browser: navigate to URL (verified 5x)");
  });

  it("includes footer instruction", () => {
    const entries: CapabilityEntry[] = [
      { toolName: "exec", how: "pnpm test", lastVerifiedTs: 1000, verifiedCount: 1 },
    ];
    const result = formatCapabilityInjection(entries)!;
    expect(result).toContain("These capabilities were confirmed in this session.");
  });
});

// ---------------------------------------------------------------------------
// formatCapabilityStatus
// ---------------------------------------------------------------------------

describe("formatCapabilityInjection with reliability (v3.3)", () => {
  it("filters out unproven capabilities", () => {
    const entries: CapabilityEntry[] = [
      { toolName: "exec", how: "pnpm test", lastVerifiedTs: 1000, verifiedCount: 5 },
      { toolName: "tts", how: "speak", lastVerifiedTs: 1000, verifiedCount: 1 },
    ];
    const reliability: CapabilityReliability[] = [
      {
        toolName: "exec",
        verifiedCount: 5,
        recentFailures: 0,
        recoveries: 0,
        reliabilityBand: "reliable",
      },
      {
        toolName: "tts",
        verifiedCount: 1,
        recentFailures: 0,
        recoveries: 0,
        reliabilityBand: "unproven",
      },
    ];
    const result = formatCapabilityInjection(entries, reliability)!;
    expect(result).toContain("CAN use exec: pnpm test (reliable, 5x)");
    expect(result).not.toContain("tts");
  });

  it("shows emerging and reliable bands", () => {
    const entries: CapabilityEntry[] = [
      { toolName: "exec", how: "pnpm test", lastVerifiedTs: 1000, verifiedCount: 5 },
      { toolName: "browser", how: "navigate", lastVerifiedTs: 1000, verifiedCount: 3 },
    ];
    const reliability: CapabilityReliability[] = [
      {
        toolName: "exec",
        verifiedCount: 5,
        recentFailures: 0,
        recoveries: 0,
        reliabilityBand: "reliable",
      },
      {
        toolName: "browser",
        verifiedCount: 3,
        recentFailures: 1,
        recoveries: 1,
        reliabilityBand: "emerging",
      },
    ];
    const result = formatCapabilityInjection(entries, reliability)!;
    expect(result).toContain("(reliable, 5x)");
    expect(result).toContain("(emerging, 3x)");
  });

  it("returns null when all capabilities are unproven", () => {
    const entries: CapabilityEntry[] = [
      { toolName: "tts", how: "speak", lastVerifiedTs: 1000, verifiedCount: 1 },
    ];
    const reliability: CapabilityReliability[] = [
      {
        toolName: "tts",
        verifiedCount: 1,
        recentFailures: 0,
        recoveries: 0,
        reliabilityBand: "unproven",
      },
    ];
    expect(formatCapabilityInjection(entries, reliability)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// formatCapabilityStatus
// ---------------------------------------------------------------------------

describe("formatCapabilityStatus", () => {
  it("returns null for empty capabilities", () => {
    expect(formatCapabilityStatus([])).toBeNull();
  });

  it("formats for CLI display with counts and age", () => {
    const now = Date.now();
    const entries: CapabilityEntry[] = [
      { toolName: "exec", how: "pnpm test", lastVerifiedTs: now - 30_000, verifiedCount: 10 },
      { toolName: "browser", how: "navigate", lastVerifiedTs: now - 120_000, verifiedCount: 3 },
    ];
    const result = formatCapabilityStatus(entries)!;
    expect(result).toContain("Capability Ledger (2 entries):");
    expect(result).toContain("exec: pnpm test (10x,");
    expect(result).toContain("browser: navigate (3x,");
  });

  it("shows reliability bands when provided", () => {
    const now = Date.now();
    const entries: CapabilityEntry[] = [
      { toolName: "exec", how: "pnpm test", lastVerifiedTs: now - 30_000, verifiedCount: 10 },
    ];
    const reliability: CapabilityReliability[] = [
      {
        toolName: "exec",
        verifiedCount: 10,
        recentFailures: 0,
        recoveries: 0,
        reliabilityBand: "reliable",
      },
    ];
    const result = formatCapabilityStatus(entries, reliability)!;
    expect(result).toContain("[reliable]");
    expect(result).toContain("Reliability: 1 reliable, 0 emerging, 0 unproven");
  });
});

// ---------------------------------------------------------------------------
// computeCapabilityReliability (RSC v3.3)
// ---------------------------------------------------------------------------

describe("computeCapabilityReliability", () => {
  const mkEvent = (verb: string, subject: string, ts = 1000): CoherenceEntry => ({
    ts,
    source: "tool_call",
    summary: `${verb} ${subject}`,
    verb: verb as EventVerb,
    subject,
    outcome: "ok",
  });

  it("returns unproven for tool with 1 use and no failures", () => {
    const caps: CapabilityEntry[] = [
      { toolName: "tts", how: "speak", lastVerifiedTs: 1000, verifiedCount: 1 },
    ];
    const result = computeCapabilityReliability(caps, []);
    expect(result).toHaveLength(1);
    expect(result[0]!.reliabilityBand).toBe("unproven");
  });

  it("returns emerging for tool with 3 uses, 1 failure, 1 recovery", () => {
    const caps: CapabilityEntry[] = [
      { toolName: "exec", how: "pnpm test", lastVerifiedTs: 3000, verifiedCount: 3 },
    ];
    const events: CoherenceEntry[] = [
      mkEvent(EventVerb.FAILED, "exec", 1000),
      mkEvent(EventVerb.CHANGED, "exec", 1100), // recovery within 3 turns
    ];
    const result = computeCapabilityReliability(caps, events);
    expect(result[0]!.reliabilityBand).toBe("emerging");
    expect(result[0]!.recentFailures).toBe(1);
    expect(result[0]!.recoveries).toBe(1);
  });

  it("returns reliable for tool with 5 uses and 0 failures", () => {
    const caps: CapabilityEntry[] = [
      { toolName: "exec", how: "pnpm test", lastVerifiedTs: 5000, verifiedCount: 5 },
    ];
    const result = computeCapabilityReliability(caps, []);
    expect(result[0]!.reliabilityBand).toBe("reliable");
  });

  it("returns emerging for tool with 10 uses but 2 recent failures", () => {
    const caps: CapabilityEntry[] = [
      { toolName: "exec", how: "pnpm test", lastVerifiedTs: 5000, verifiedCount: 10 },
    ];
    const events: CoherenceEntry[] = [
      mkEvent(EventVerb.FAILED, "exec", 1000),
      mkEvent(EventVerb.FAILED, "exec", 2000),
    ];
    const result = computeCapabilityReliability(caps, events);
    expect(result[0]!.reliabilityBand).toBe("emerging");
    expect(result[0]!.recentFailures).toBe(2);
  });

  it("detects FAILED→CHANGED recovery within 3 turns", () => {
    const caps: CapabilityEntry[] = [
      { toolName: "write", how: "write file", lastVerifiedTs: 5000, verifiedCount: 5 },
    ];
    const events: CoherenceEntry[] = [
      mkEvent(EventVerb.FAILED, "write", 1000),
      mkEvent(EventVerb.DECIDED, "task", 1100), // different tool, skip
      mkEvent(EventVerb.CHANGED, "write", 1200), // recovery at position i+2 (within 3)
    ];
    const result = computeCapabilityReliability(caps, events);
    expect(result[0]!.recoveries).toBe(1);
  });

  it("does NOT count recovery beyond 3 turns", () => {
    const caps: CapabilityEntry[] = [
      { toolName: "write", how: "write file", lastVerifiedTs: 5000, verifiedCount: 5 },
    ];
    const events: CoherenceEntry[] = [
      mkEvent(EventVerb.FAILED, "write", 1000),
      mkEvent(EventVerb.DECIDED, "task1", 1100),
      mkEvent(EventVerb.DECIDED, "task2", 1200),
      mkEvent(EventVerb.DECIDED, "task3", 1300),
      mkEvent(EventVerb.CHANGED, "write", 1400), // position i+4, beyond window
    ];
    const result = computeCapabilityReliability(caps, events);
    expect(result[0]!.recoveries).toBe(0);
    expect(result[0]!.recentFailures).toBe(1);
  });

  it("excludes tools not in capability ledger", () => {
    const caps: CapabilityEntry[] = [
      { toolName: "exec", how: "pnpm test", lastVerifiedTs: 1000, verifiedCount: 5 },
    ];
    const events: CoherenceEntry[] = [
      mkEvent(EventVerb.FAILED, "browser", 1000), // not in ledger
    ];
    const result = computeCapabilityReliability(caps, events);
    expect(result).toHaveLength(1);
    expect(result[0]!.toolName).toBe("exec");
    expect(result[0]!.recentFailures).toBe(0);
  });

  it("returns empty array for empty capabilities", () => {
    expect(computeCapabilityReliability([], [])).toEqual([]);
  });

  it("ignores non-structured events", () => {
    const caps: CapabilityEntry[] = [
      { toolName: "exec", how: "pnpm test", lastVerifiedTs: 1000, verifiedCount: 5 },
    ];
    // Legacy entry without verb field
    const events: CoherenceEntry[] = [{ ts: 1000, source: "tool_call", summary: "FAILED exec" }];
    const result = computeCapabilityReliability(caps, events);
    expect(result[0]!.recentFailures).toBe(0); // not counted — no verb
    expect(result[0]!.reliabilityBand).toBe("reliable");
  });
});

// ---------------------------------------------------------------------------
// resolveProactivityLevel (RSC v3.4)
// ---------------------------------------------------------------------------

describe("resolveProactivityLevel (v3.4)", () => {
  it("reliable + proven → autonomous", () => {
    expect(resolveProactivityLevel("proven", "reliable")).toBe("autonomous");
  });

  it("reliable + established → autonomous", () => {
    expect(resolveProactivityLevel("established", "reliable")).toBe("autonomous");
  });

  it("reliable + emerging → offer", () => {
    expect(resolveProactivityLevel("emerging", "reliable")).toBe("offer");
  });

  it("reliable + new → confirm", () => {
    expect(resolveProactivityLevel("new", "reliable")).toBe("confirm");
  });

  it("emerging + proven → offer", () => {
    expect(resolveProactivityLevel("proven", "emerging")).toBe("offer");
  });

  it("emerging + established → offer", () => {
    expect(resolveProactivityLevel("established", "emerging")).toBe("offer");
  });

  it("emerging + emerging → confirm", () => {
    expect(resolveProactivityLevel("emerging", "emerging")).toBe("confirm");
  });

  it("emerging + new → confirm", () => {
    expect(resolveProactivityLevel("new", "emerging")).toBe("confirm");
  });
});

// ---------------------------------------------------------------------------
// formatCapabilityInjection with trust tier (RSC v3.4)
// ---------------------------------------------------------------------------

describe("formatCapabilityInjection with trust tier (v3.4)", () => {
  it("includes trust tier label when provided", () => {
    const entries: CapabilityEntry[] = [
      { toolName: "exec", how: "pnpm test", lastVerifiedTs: 1000, verifiedCount: 5 },
    ];
    const reliability: CapabilityReliability[] = [
      {
        toolName: "exec",
        verifiedCount: 5,
        recentFailures: 0,
        recoveries: 0,
        reliabilityBand: "reliable",
      },
    ];
    const result = formatCapabilityInjection(entries, reliability, "established")!;
    expect(result).toContain("Your trust tier: established");
  });

  it("annotates reliable+established as autonomous", () => {
    const entries: CapabilityEntry[] = [
      { toolName: "exec", how: "pnpm test", lastVerifiedTs: 1000, verifiedCount: 5 },
    ];
    const reliability: CapabilityReliability[] = [
      {
        toolName: "exec",
        verifiedCount: 5,
        recentFailures: 0,
        recoveries: 0,
        reliabilityBand: "reliable",
      },
    ];
    const result = formatCapabilityInjection(entries, reliability, "established")!;
    expect(result).toContain("use autonomously when relevant");
  });

  it("annotates emerging+new as confirm", () => {
    const entries: CapabilityEntry[] = [
      { toolName: "browser", how: "navigate", lastVerifiedTs: 1000, verifiedCount: 3 },
    ];
    const reliability: CapabilityReliability[] = [
      {
        toolName: "browser",
        verifiedCount: 3,
        recentFailures: 1,
        recoveries: 1,
        reliabilityBand: "emerging",
      },
    ];
    const result = formatCapabilityInjection(entries, reliability, "new")!;
    expect(result).toContain("confirm before using");
  });

  it("uses trust-aware footer for established tier", () => {
    const entries: CapabilityEntry[] = [
      { toolName: "exec", how: "pnpm test", lastVerifiedTs: 1000, verifiedCount: 5 },
    ];
    const reliability: CapabilityReliability[] = [
      {
        toolName: "exec",
        verifiedCount: 5,
        recentFailures: 0,
        recoveries: 0,
        reliabilityBand: "reliable",
      },
    ];
    const result = formatCapabilityInjection(entries, reliability, "established")!;
    expect(result).toContain("Act on autonomous capabilities without asking");
  });

  it("uses cautious footer for new tier", () => {
    const entries: CapabilityEntry[] = [
      { toolName: "exec", how: "pnpm test", lastVerifiedTs: 1000, verifiedCount: 5 },
    ];
    const reliability: CapabilityReliability[] = [
      {
        toolName: "exec",
        verifiedCount: 5,
        recentFailures: 0,
        recoveries: 0,
        reliabilityBand: "reliable",
      },
    ];
    const result = formatCapabilityInjection(entries, reliability, "new")!;
    expect(result).toContain("Confirm with the user before using them");
  });

  it("falls back to static footer when trustTier is undefined (backward compat)", () => {
    const entries: CapabilityEntry[] = [
      { toolName: "exec", how: "pnpm test", lastVerifiedTs: 1000, verifiedCount: 5 },
    ];
    const reliability: CapabilityReliability[] = [
      {
        toolName: "exec",
        verifiedCount: 5,
        recentFailures: 0,
        recoveries: 0,
        reliabilityBand: "reliable",
      },
    ];
    const result = formatCapabilityInjection(entries, reliability)!;
    expect(result).toContain("Use them proactively when relevant");
    expect(result).not.toContain("trust tier");
  });

  it("mixed reliability bands get different proactivity levels", () => {
    const entries: CapabilityEntry[] = [
      { toolName: "exec", how: "pnpm test", lastVerifiedTs: 1000, verifiedCount: 10 },
      { toolName: "browser", how: "navigate", lastVerifiedTs: 1000, verifiedCount: 3 },
    ];
    const reliability: CapabilityReliability[] = [
      {
        toolName: "exec",
        verifiedCount: 10,
        recentFailures: 0,
        recoveries: 0,
        reliabilityBand: "reliable",
      },
      {
        toolName: "browser",
        verifiedCount: 3,
        recentFailures: 1,
        recoveries: 1,
        reliabilityBand: "emerging",
      },
    ];
    const result = formatCapabilityInjection(entries, reliability, "established")!;
    expect(result).toContain("exec");
    expect(result).toContain("use autonomously when relevant");
    expect(result).toContain("browser");
    expect(result).toContain("offer to use when relevant");
  });
});

// ---------------------------------------------------------------------------
// formatCapabilityStatus with trust tier (RSC v3.4)
// ---------------------------------------------------------------------------

describe("formatCapabilityStatus with trust tier (v3.4)", () => {
  it("shows proactivity level alongside reliability band", () => {
    const now = Date.now();
    const entries: CapabilityEntry[] = [
      { toolName: "exec", how: "pnpm test", lastVerifiedTs: now - 30_000, verifiedCount: 10 },
    ];
    const reliability: CapabilityReliability[] = [
      {
        toolName: "exec",
        verifiedCount: 10,
        recentFailures: 0,
        recoveries: 0,
        reliabilityBand: "reliable",
      },
    ];
    const result = formatCapabilityStatus(entries, reliability, "established")!;
    expect(result).toContain("[reliable]");
    expect(result).toContain("→ autonomous");
  });

  it("shows proactivity summary line", () => {
    const now = Date.now();
    const entries: CapabilityEntry[] = [
      { toolName: "exec", how: "pnpm test", lastVerifiedTs: now - 30_000, verifiedCount: 10 },
      { toolName: "browser", how: "navigate", lastVerifiedTs: now - 30_000, verifiedCount: 3 },
    ];
    const reliability: CapabilityReliability[] = [
      {
        toolName: "exec",
        verifiedCount: 10,
        recentFailures: 0,
        recoveries: 0,
        reliabilityBand: "reliable",
      },
      {
        toolName: "browser",
        verifiedCount: 3,
        recentFailures: 1,
        recoveries: 1,
        reliabilityBand: "emerging",
      },
    ];
    const result = formatCapabilityStatus(entries, reliability, "established")!;
    expect(result).toContain("Proactivity: 1 autonomous, 1 offer, 0 confirm (trust: established)");
  });

  it("omits proactivity when no trust tier (backward compat)", () => {
    const now = Date.now();
    const entries: CapabilityEntry[] = [
      { toolName: "exec", how: "pnpm test", lastVerifiedTs: now - 30_000, verifiedCount: 10 },
    ];
    const reliability: CapabilityReliability[] = [
      {
        toolName: "exec",
        verifiedCount: 10,
        recentFailures: 0,
        recoveries: 0,
        reliabilityBand: "reliable",
      },
    ];
    const result = formatCapabilityStatus(entries, reliability)!;
    expect(result).not.toContain("Proactivity:");
    expect(result).not.toContain("→ autonomous");
  });
});
