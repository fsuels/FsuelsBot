/**
 * Capability Ledger — RSC v3.2 anti-amnesia memory.
 *
 * Tracks which tools the agent has successfully used so that after compaction
 * or context loss, the agent still knows what it can do. Capabilities are
 * auto-discovered from successful tool calls — no user grants required.
 *
 * Stored on SessionEntry.capabilityLedger, persists across compaction.
 * Injected pre-turn as "## Verified Capabilities" inside the coherence
 * intervention.
 *
 * RSC v3.3 adds derived reliability bands (unproven/emerging/reliable) by
 * cross-referencing the capability ledger with coherence events. Reliability
 * is never stored — always computed on the fly.
 */

import { type CoherenceEntry, EventVerb, isStructuredEvent } from "./coherence-log.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A verified capability learned from successful tool usage. */
export type CapabilityEntry = {
  /** Tool name (matches tool schema name). */
  toolName: string;
  /** Short human-readable usage pattern (e.g. "pnpm test", "navigate to URL"). */
  how: string;
  /** Timestamp (ms) of the most recent successful use. */
  lastVerifiedTs: number;
  /** Total number of successful uses observed. */
  verifiedCount: number;
};

/** Derived reliability assessment for a capability (RSC v3.3). Never stored. */
export type CapabilityReliability = {
  toolName: string;
  verifiedCount: number;
  recentFailures: number;
  recoveries: number;
  reliabilityBand: ReliabilityBand;
};

export type ReliabilityBand = "unproven" | "emerging" | "reliable";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum capability entries stored per session. */
export const MAX_CAPABILITY_ENTRIES = 12;

/** Maximum capabilities injected into the prompt per turn. */
const MAX_CAPABILITY_INJECTION = 8;

// ---------------------------------------------------------------------------
// State resolution
// ---------------------------------------------------------------------------

/** Resolve capability ledger from raw session data. */
export function resolveCapabilityLedger(raw: {
  capabilityLedger?: CapabilityEntry[];
}): CapabilityEntry[] {
  const ledger = raw.capabilityLedger;
  if (!Array.isArray(ledger)) return [];
  if (ledger.length <= MAX_CAPABILITY_ENTRIES) return ledger;
  // Cap: keep most-recently-verified
  return [...ledger]
    .sort((a, b) => b.lastVerifiedTs - a.lastVerifiedTs)
    .slice(0, MAX_CAPABILITY_ENTRIES);
}

// ---------------------------------------------------------------------------
// Mutation
// ---------------------------------------------------------------------------

/**
 * Upsert a capability entry after a successful tool call.
 * - Existing tool: increment verifiedCount, update lastVerifiedTs, update how if longer.
 * - New tool: create with verifiedCount 1.
 * - Over cap: evict least-recently-verified.
 */
export function upsertCapability(
  capabilities: CapabilityEntry[],
  toolName: string,
  how: string | undefined,
  now: number,
): CapabilityEntry[] {
  const result = [...capabilities];
  const idx = result.findIndex((c) => c.toolName === toolName);

  if (idx >= 0) {
    const existing = result[idx]!;
    result[idx] = {
      ...existing,
      lastVerifiedTs: now,
      verifiedCount: existing.verifiedCount + 1,
      how: how && how.length > (existing.how?.length ?? 0) ? how : existing.how,
    };
  } else {
    result.push({
      toolName,
      how: how ?? toolName,
      lastVerifiedTs: now,
      verifiedCount: 1,
    });
  }

  // Cap: evict least-recently-verified
  if (result.length > MAX_CAPABILITY_ENTRIES) {
    result.sort((a, b) => b.lastVerifiedTs - a.lastVerifiedTs);
    return result.slice(0, MAX_CAPABILITY_ENTRIES);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Injection
// ---------------------------------------------------------------------------

/** Select top capabilities for pre-turn injection. */
export function selectCapabilitiesForInjection(
  capabilities: CapabilityEntry[],
  maxLines: number = MAX_CAPABILITY_INJECTION,
): CapabilityEntry[] {
  if (capabilities.length === 0) return [];

  return [...capabilities]
    .sort((a, b) => {
      if (b.verifiedCount !== a.verifiedCount) return b.verifiedCount - a.verifiedCount;
      return b.lastVerifiedTs - a.lastVerifiedTs;
    })
    .slice(0, maxLines);
}

/**
 * Format capability entries for system prompt injection. Returns null if empty.
 *
 * RSC v3.3: When reliability data is provided, annotates each line with
 * the reliability band and filters out "unproven" capabilities (single-use
 * tools haven't earned a CAN claim).
 */
export function formatCapabilityInjection(
  capabilities: CapabilityEntry[],
  reliability?: CapabilityReliability[],
): string | null {
  const selected = selectCapabilitiesForInjection(capabilities);
  if (selected.length === 0) return null;

  // Build lookup for reliability bands
  const bandByTool = new Map<string, ReliabilityBand>();
  if (reliability) {
    for (const r of reliability) {
      bandByTool.set(r.toolName, r.reliabilityBand);
    }
  }

  const lines: string[] = ["## Verified Capabilities"];
  for (const cap of selected) {
    const band = bandByTool.get(cap.toolName);
    // RSC v3.3: Filter out unproven capabilities when reliability data is available
    if (band === "unproven") continue;
    if (band) {
      lines.push(`- CAN use ${cap.toolName}: ${cap.how} (${band}, ${cap.verifiedCount}x)`);
    } else {
      // Backward compat: no reliability data → use original format
      lines.push(`- CAN use ${cap.toolName}: ${cap.how} (verified ${cap.verifiedCount}x)`);
    }
  }

  // If all capabilities were filtered out (all unproven), return null
  if (lines.length <= 1) return null;

  lines.push(
    "These capabilities were confirmed in this session. Use them proactively when relevant.",
  );

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Reliability computation (RSC v3.3)
// ---------------------------------------------------------------------------

/** Recovery detection window: FAILED→CHANGED within this many events. */
const RECOVERY_WINDOW = 3;

/** Minimum verified uses to leave "unproven". */
const EMERGING_THRESHOLD = 2;

/** Minimum verified uses for "reliable" (with zero recent failures). */
const RELIABLE_THRESHOLD = 5;

/**
 * Derive reliability band for a single capability by cross-referencing
 * the capability ledger entry with coherence events.
 */
function resolveReliabilityBand(
  verifiedCount: number,
  recentFailures: number,
  recoveries: number,
): ReliabilityBand {
  if (verifiedCount < EMERGING_THRESHOLD) return "unproven";
  if (verifiedCount >= RELIABLE_THRESHOLD && recentFailures === 0) return "reliable";
  if (recoveries >= recentFailures) return "emerging";
  return "emerging";
}

/**
 * Compute per-tool reliability by cross-referencing the capability ledger
 * with structured coherence events. Pure function — no storage.
 *
 * Only capabilities present in the ledger are included in the output.
 * FAILED events are matched to tools via the `subject` field (which stores
 * toolName in the coherence pipeline — see drift-coherence-update.ts).
 */
export function computeCapabilityReliability(
  capabilities: CapabilityEntry[],
  events: CoherenceEntry[],
): CapabilityReliability[] {
  if (capabilities.length === 0) return [];

  const structured = events.filter(isStructuredEvent);

  // Count failures and recoveries per tool
  const failuresByTool = new Map<string, number>();
  const recoveriesByTool = new Map<string, number>();

  for (let i = 0; i < structured.length; i++) {
    const e = structured[i]!;
    if (e.verb !== EventVerb.FAILED) continue;
    const tool = e.subject;
    if (!tool) continue;

    failuresByTool.set(tool, (failuresByTool.get(tool) ?? 0) + 1);

    // Check for recovery: CHANGED on same subject within RECOVERY_WINDOW events
    for (let j = i + 1; j < Math.min(i + RECOVERY_WINDOW + 1, structured.length); j++) {
      const next = structured[j]!;
      if (next.verb === EventVerb.CHANGED && next.subject === tool) {
        recoveriesByTool.set(tool, (recoveriesByTool.get(tool) ?? 0) + 1);
        break;
      }
    }
  }

  return capabilities.map((cap) => {
    const recentFailures = failuresByTool.get(cap.toolName) ?? 0;
    const recoveries = recoveriesByTool.get(cap.toolName) ?? 0;
    return {
      toolName: cap.toolName,
      verifiedCount: cap.verifiedCount,
      recentFailures,
      recoveries,
      reliabilityBand: resolveReliabilityBand(cap.verifiedCount, recentFailures, recoveries),
    };
  });
}

// ---------------------------------------------------------------------------
// CLI status display
// ---------------------------------------------------------------------------

/**
 * Format capability ledger for drift-status CLI output.
 *
 * RSC v3.3: When reliability data is provided, appends reliability band
 * to each line and includes a summary count.
 */
export function formatCapabilityStatus(
  capabilities: CapabilityEntry[],
  reliability?: CapabilityReliability[],
): string | null {
  if (capabilities.length === 0) return null;

  const bandByTool = new Map<string, ReliabilityBand>();
  if (reliability) {
    for (const r of reliability) {
      bandByTool.set(r.toolName, r.reliabilityBand);
    }
  }

  const sorted = [...capabilities].sort((a, b) => b.verifiedCount - a.verifiedCount);
  const lines: string[] = [`Capability Ledger (${sorted.length} entries):`];
  for (const cap of sorted) {
    const age = Date.now() - cap.lastVerifiedTs;
    const ageStr =
      age < 60_000
        ? "<1m ago"
        : age < 3_600_000
          ? `${Math.floor(age / 60_000)}m ago`
          : `${Math.floor(age / 3_600_000)}h ago`;
    const band = bandByTool.get(cap.toolName);
    const bandStr = band ? ` [${band}]` : "";
    lines.push(`  ${cap.toolName}: ${cap.how} (${cap.verifiedCount}x, last ${ageStr})${bandStr}`);
  }

  // RSC v3.3: Append reliability summary
  if (reliability && reliability.length > 0) {
    const reliable = reliability.filter((r) => r.reliabilityBand === "reliable").length;
    const emerging = reliability.filter((r) => r.reliabilityBand === "emerging").length;
    const unproven = reliability.filter((r) => r.reliabilityBand === "unproven").length;
    lines.push(`  Reliability: ${reliable} reliable, ${emerging} emerging, ${unproven} unproven`);
  }

  return lines.join("\n");
}
