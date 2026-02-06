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
 */

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

/** Format capability entries for system prompt injection. Returns null if empty. */
export function formatCapabilityInjection(capabilities: CapabilityEntry[]): string | null {
  const selected = selectCapabilitiesForInjection(capabilities);
  if (selected.length === 0) return null;

  const lines: string[] = ["## Verified Capabilities"];
  for (const cap of selected) {
    lines.push(`- CAN use ${cap.toolName}: ${cap.how} (verified ${cap.verifiedCount}x)`);
  }
  lines.push(
    "These capabilities were confirmed in this session. Use them proactively when relevant.",
  );

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// CLI status display
// ---------------------------------------------------------------------------

/** Format capability ledger for drift-status CLI output. */
export function formatCapabilityStatus(capabilities: CapabilityEntry[]): string | null {
  if (capabilities.length === 0) return null;

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
    lines.push(`  ${cap.toolName}: ${cap.how} (${cap.verifiedCount}x, last ${ageStr})`);
  }
  return lines.join("\n");
}
