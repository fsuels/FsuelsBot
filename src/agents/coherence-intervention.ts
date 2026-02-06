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
} from "./coherence-log.js";
import {
  resolveToolFailureState,
  resolveFailureSignatures,
  buildToolAvoidanceInjection,
  buildFailureMemoryHint,
} from "./tool-failure-tracker.js";
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
  },
): CoherenceIntervention | null {
  if (!entry) return null;

  const sections: string[] = [];

  // Coherence log section
  const coherenceState = resolveCoherenceLog({
    coherenceEntries: entry.coherenceEntries,
    coherencePinned: entry.coherencePinned,
  });
  const coherence = buildCoherenceIntervention(coherenceState);
  if (coherence) {
    sections.push(coherence.text);
  }

  // RSC v3.0: Event memory section — verb-indexed associative recall
  const selectedEvents = selectEventsForInjection(coherenceState);
  const eventInjection = formatEventMemoryInjection(selectedEvents);
  if (eventInjection) {
    sections.push(eventInjection);
  }

  // RSC v3.1: Cross-session promoted events
  if (opts?.sessionStore && opts.sessionKey) {
    const promotedEvents = resolvePromotedEventsForSession(
      opts.sessionStore,
      opts.sessionKey,
      entry,
    );
    if (promotedEvents) {
      const injection = formatPromotedEventsInjection(promotedEvents);
      if (injection) {
        sections.push(injection);
      }
    }
  }

  // Tool avoidance section (RSC v2.1 item 3)
  const toolState = resolveToolFailureState({ toolFailures: entry.toolFailures });
  const avoidance = buildToolAvoidanceInjection(toolState);
  if (avoidance) {
    sections.push(avoidance);
  }

  // Failure memory section (RSC v2.1 item 4)
  const signatures = resolveFailureSignatures({ failureSignatures: entry.failureSignatures });
  const failureHint = buildFailureMemoryHint(signatures);
  if (failureHint) {
    sections.push(failureHint);
  }

  if (sections.length === 0) return null;
  return { text: sections.join("\n\n") };
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
