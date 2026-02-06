import { describe, expect, it } from "vitest";
import {
  type CapabilityEntry,
  formatCapabilityInjection,
  formatCapabilityStatus,
  MAX_CAPABILITY_ENTRIES,
  resolveCapabilityLedger,
  selectCapabilitiesForInjection,
  upsertCapability,
} from "./capability-ledger.js";

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
});
