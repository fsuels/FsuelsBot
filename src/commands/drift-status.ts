/**
 * CLI command: moltbot agent drift-status
 *
 * Displays drift detection state and coherence log for a given session.
 * Used for threshold calibration and debugging.
 */

import { resolveDriftState, formatDriftStatus } from "../agents/drift-detection.js";
import {
  resolveCoherenceLog,
  formatCoherenceLog,
  formatEventMemoryStatus,
  analyzeVerbTaxonomy,
  formatVerbTaxonomyReport,
  computeTrustSignals,
  formatTrustStatus,
  formatPromotedEventsStatus,
} from "../agents/coherence-log.js";
import {
  resolveCapabilityLedger,
  formatCapabilityStatus,
  computeCapabilityReliability,
} from "../agents/capability-ledger.js";
import { loadSessionStore, resolveStorePath } from "../config/sessions.js";
import { loadConfig } from "../config/config.js";
import type { SessionEntry } from "../config/sessions/types.js";
import type { RuntimeEnv } from "../runtime.js";

export async function driftStatusCommand(
  params: {
    sessionKey?: string;
    json?: boolean;
    all?: boolean;
  },
  runtime: RuntimeEnv,
): Promise<void> {
  const cfg = loadConfig();
  const storePath = resolveStorePath(cfg?.session?.store);

  let store: Record<string, SessionEntry>;
  try {
    store = loadSessionStore(storePath);
  } catch {
    runtime.error(`Failed to load session store at: ${storePath}`);
    return;
  }

  const entries = params.sessionKey ? { [params.sessionKey]: store[params.sessionKey] } : store;

  if (params.sessionKey && !store[params.sessionKey]) {
    runtime.error(`Session not found: ${params.sessionKey}`);
    runtime.error(`Available sessions: ${Object.keys(store).slice(0, 10).join(", ")}`);
    return;
  }

  const results: Array<{
    sessionKey: string;
    driftStatus: string;
    coherenceStatus: string;
    eventMemoryStatus: string;
    taxonomyStatus: string;
    trustStatus: string;
    promotionStatus: string;
    capabilityStatus: string;
    level: string;
  }> = [];

  for (const [key, entry] of Object.entries(entries)) {
    if (!entry) continue;

    const driftState = resolveDriftState({
      driftEvents: entry.driftEvents,
      driftBaselineRate: entry.driftBaselineRate,
      driftBaselineTurns: entry.driftBaselineTurns,
      driftLevel: entry.driftLevel,
      driftLevelChangedAt: entry.driftLevelChangedAt,
      driftResponseCount: entry.driftResponseCount,
    });
    const coherenceState = resolveCoherenceLog({
      coherenceEntries: entry.coherenceEntries,
      coherencePinned: entry.coherencePinned,
    });

    // Skip sessions with no drift data unless --all
    if (
      !params.all &&
      !params.sessionKey &&
      driftState.events.length === 0 &&
      coherenceState.entries.length === 0
    ) {
      continue;
    }

    // RSC v3.1: Taxonomy analysis, trust signals, promotion status
    const allEvents = [...coherenceState.pinned, ...coherenceState.entries];
    const taxonomyReport = analyzeVerbTaxonomy(allEvents);
    const trustSignals = computeTrustSignals(allEvents);

    // RSC v3.2 + v3.3: Capability ledger with reliability
    const capabilityLedger = resolveCapabilityLedger({
      capabilityLedger: entry.capabilityLedger,
    });
    const capabilityReliability = computeCapabilityReliability(capabilityLedger, allEvents);

    results.push({
      sessionKey: key,
      driftStatus: formatDriftStatus(driftState),
      coherenceStatus: formatCoherenceLog(coherenceState),
      eventMemoryStatus: formatEventMemoryStatus(coherenceState),
      taxonomyStatus: formatVerbTaxonomyReport(taxonomyReport),
      trustStatus: formatTrustStatus(trustSignals),
      promotionStatus: formatPromotedEventsStatus(
        entry.promotedEvents ?? [],
        entry.promotionCandidates ?? [],
      ),
      capabilityStatus:
        formatCapabilityStatus(capabilityLedger, capabilityReliability, trustSignals.tier) ??
        "Capability Ledger: (empty)",
      level: driftState.level,
    });
  }

  if (params.json) {
    runtime.log(JSON.stringify(results, null, 2));
    return;
  }

  if (results.length === 0) {
    runtime.log("No sessions with drift/coherence data found. Use --all to show all sessions.");
    return;
  }

  for (const result of results) {
    runtime.log(`\n${"=".repeat(60)}`);
    runtime.log(`Session: ${result.sessionKey}`);
    runtime.log("=".repeat(60));
    runtime.log("");
    runtime.log(result.driftStatus);
    runtime.log("");
    runtime.log(result.coherenceStatus);
    runtime.log("");
    runtime.log(result.eventMemoryStatus);
    runtime.log("");
    runtime.log(result.taxonomyStatus);
    runtime.log("");
    runtime.log(result.trustStatus);
    runtime.log("");
    runtime.log(result.promotionStatus);
    runtime.log("");
    runtime.log(result.capabilityStatus);
  }
}
