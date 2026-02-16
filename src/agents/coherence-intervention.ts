/**
 * Coherence Intervention — RSC v2.1 pre-turn awareness injection.
 *
 * Reads the coherence log (captured in v2.0) and builds a system prompt
 * section that reminds the agent of committed decisions and recent actions.
 * This closes the loop: v2.0 captures decisions, v2.1 makes them actionable.
 *
 * Also assembles tool avoidance warnings (v2.1 item 3) and failure memory
 * hints (v2.1 item 4) into a single injection to minimize param threading.
 */

import {
  type CoherenceLogState,
  resolveCoherenceLog,
  selectEventsForInjection,
  formatEventMemoryInjection,
  pruneRetiredPromotedEvents,
  formatPromotedEventsInjection,
  computeTrustSignals,
} from "./coherence-log.js";
import {
  resolveToolFailureState,
  resolveFailureSignatures,
  buildToolAvoidanceInjection,
  buildFailureMemoryHint,
} from "./tool-failure-tracker.js";
import {
  resolveCapabilityLedger,
  formatCapabilityInjection,
  computeCapabilityReliability,
} from "./capability-ledger.js";
import type { SessionEntry } from "../config/sessions/types.js";
import { resolveThreadParentSessionKey } from "../sessions/session-key-utils.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CoherenceIntervention = {
  text: string;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum FIFO entries before coherence section activates (avoids noise on fresh sessions). */
const MIN_ENTRIES_FOR_INTERVENTION = 3;

/** Maximum recent entries to show in the prompt. */
const MAX_RECENT_SHOWN = 5;

/**
 * Default maximum character budget for all coherence intervention sections combined.
 * Prevents coherence injection from growing unboundedly and displacing conversation history.
 * Can be overridden via the `maxInjectionChars` option.
 */
const DEFAULT_MAX_INJECTION_CHARS = 4000;

/**
 * Section priority order for budget enforcement.
 * When the combined injection exceeds maxInjectionChars, lower-priority
 * sections are truncated or dropped first.
 *
 * Priority (highest first):
 * 1. Tool avoidance — safety-critical, prevents repeating known failures
 * 2. Coherence log — committed decisions and recent actions
 * 3. Promoted events — cross-session inherited context
 * 4. Capabilities — verified tool capabilities
 * 5. Event memory — verb-indexed associative recall
 * 6. Failure memory — recurring error pattern hints
 */
type PrioritizedSection = { priority: number; text: string };

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a coherence intervention from the current log state.
 * Returns null if there's insufficient data to be useful.
 */
export function buildCoherenceIntervention(state: CoherenceLogState): CoherenceIntervention | null {
  if (state.pinned.length === 0 && state.entries.length < MIN_ENTRIES_FOR_INTERVENTION) {
    return null;
  }

  const lines: string[] = ["## Recent Decisions"];

  // Pinned (committed) decisions first
  if (state.pinned.length > 0) {
    for (const entry of state.pinned) {
      lines.push(`- Committed: ${entry.summary}`);
    }
  }

  // Recent FIFO entries
  const recent = state.entries.slice(-MAX_RECENT_SHOWN);
  if (recent.length > 0) {
    for (const entry of recent) {
      lines.push(`- Recent: ${entry.summary}`);
    }
  }

  lines.push("Before contradicting a committed decision, state why the change is necessary.");

  return { text: lines.join("\n") };
}

/**
 * Resolve coherence intervention for a session entry.
 * Combines coherence log, tool avoidance, failure memory, and cross-session memory
 * into a single injection. Called pre-turn in agent-runner-execution.ts.
 *
 * The optional `opts` parameter enables cross-session event promotion (RSC v3.1).
 * When provided, the function loads the parent session's promoted events and injects
 * them as a separate section. This is backward-compatible — omitting opts disables
 * cross-session memory without breaking existing callers.
 */
export function resolveCoherenceInterventionForSession(
  entry?: SessionEntry,
  opts?: {
    sessionStore?: Record<string, SessionEntry>;
    sessionKey?: string;
    /** Maximum characters for all coherence injection sections combined. */
    maxInjectionChars?: number;
  },
): CoherenceIntervention | null {
  if (!entry) return null;

  const maxChars = opts?.maxInjectionChars ?? DEFAULT_MAX_INJECTION_CHARS;

  // Collect prioritized sections (higher priority = lower number = kept first)
  const prioritized: PrioritizedSection[] = [];

  // Priority 1: Tool avoidance (safety-critical)
  const toolState = resolveToolFailureState({ toolFailures: entry.toolFailures });
  const avoidance = buildToolAvoidanceInjection(toolState);
  if (avoidance) {
    prioritized.push({ priority: 1, text: avoidance });
  }

  // Priority 2: Coherence log (committed decisions + recent actions)
  const coherenceState = resolveCoherenceLog({
    coherenceEntries: entry.coherenceEntries,
    coherencePinned: entry.coherencePinned,
  });
  const coherence = buildCoherenceIntervention(coherenceState);
  if (coherence) {
    prioritized.push({ priority: 2, text: coherence.text });
  }

  // Priority 3: Cross-session promoted events (RSC v3.1)
  if (opts?.sessionStore && opts.sessionKey) {
    const promotedEvents = resolvePromotedEventsForSession(
      opts.sessionStore,
      opts.sessionKey,
      entry,
    );
    if (promotedEvents) {
      const injection = formatPromotedEventsInjection(promotedEvents);
      if (injection) {
        prioritized.push({ priority: 3, text: injection });
      }
    }
  }

  // Priority 4: Capability ledger (RSC v3.2-v3.4)
  const capabilityState = resolveCapabilityLedger({ capabilityLedger: entry.capabilityLedger });
  const allEvents = [...coherenceState.pinned, ...coherenceState.entries];
  const capabilityReliability = computeCapabilityReliability(capabilityState, allEvents);
  const trustSignals = computeTrustSignals(allEvents);
  const capabilityInjection = formatCapabilityInjection(
    capabilityState,
    capabilityReliability,
    trustSignals.tier,
  );
  if (capabilityInjection) {
    prioritized.push({ priority: 4, text: capabilityInjection });
  }

  // Priority 5: Event memory (RSC v3.0 — verb-indexed recall)
  const selectedEvents = selectEventsForInjection(coherenceState);
  const eventInjection = formatEventMemoryInjection(selectedEvents);
  if (eventInjection) {
    prioritized.push({ priority: 5, text: eventInjection });
  }

  // Priority 6: Failure memory hints (RSC v2.1 item 4)
  const signatures = resolveFailureSignatures({ failureSignatures: entry.failureSignatures });
  const failureHint = buildFailureMemoryHint(signatures);
  if (failureHint) {
    prioritized.push({ priority: 6, text: failureHint });
  }

  if (prioritized.length === 0) return null;

  // Enforce budget: include sections in priority order until budget is exhausted.
  // Sort by priority (lowest number = highest priority).
  prioritized.sort((a, b) => a.priority - b.priority);

  const included: string[] = [];
  let remaining = maxChars;
  for (const section of prioritized) {
    if (section.text.length <= remaining) {
      included.push(section.text);
      remaining -= section.text.length;
    } else if (remaining > 100) {
      // Partial inclusion: truncate section to fit, but only if we have meaningful space
      included.push(section.text.slice(0, remaining - 3) + "...");
      remaining = 0;
    }
    // else: drop section entirely (budget exhausted)
  }

  if (included.length === 0) return null;
  return { text: included.join("\n\n") };
}

/**
 * Resolve promoted events for a session by checking self and parent session.
 * Returns the promoted events array (already pruned of retired events), or null if none.
 */
function resolvePromotedEventsForSession(
  sessionStore: Record<string, SessionEntry>,
  sessionKey: string,
  entry: SessionEntry,
): import("../config/sessions/types.js").PromotedEvent[] | null {
  // Check self first
  const selfPromoted = entry.promotedEvents;
  if (selfPromoted && selfPromoted.length > 0) {
    return pruneRetiredPromotedEvents(selfPromoted);
  }

  // Check parent session
  const parentKey = resolveThreadParentSessionKey(sessionKey);
  if (parentKey && parentKey !== sessionKey) {
    const parentEntry = sessionStore[parentKey];
    if (parentEntry?.promotedEvents && parentEntry.promotedEvents.length > 0) {
      return pruneRetiredPromotedEvents(parentEntry.promotedEvents);
    }
  }

  return null;
}
