/**
 * Post-turn drift detection and coherence log update.
 *
 * Called after each agent turn completes to record correction events
 * and persist drift/coherence state to the session store.
 */

import {
  type CorrectionEvent,
  resolveDriftState,
  recordTurnOutcome,
  buildDriftPromptInjection,
} from "../../agents/drift-detection.js";
import {
  resolveCoherenceLog,
  appendCoherenceEntry,
  buildModelSwitchEntry,
  buildToolMetaCoherenceEntry,
} from "../../agents/coherence-log.js";
import {
  resolveToolFailureState,
  recordToolOutcome,
  recordFailureSignature,
  resolveFailureSignatures,
} from "../../agents/tool-failure-tracker.js";
import { updateSessionStoreEntry, type SessionEntry } from "../../config/sessions.js";
import { logVerbose } from "../../globals.js";

export type TurnCorrectionSignals = {
  /** Whether a model fallback was used (provider/model differs from configured default). */
  modelFallback: boolean;
  /** Whether auto-compaction was triggered during the turn. */
  autoCompaction: boolean;
  /** Whether a context overflow or compaction failure error occurred. */
  contextOverflow: boolean;
  /** Whether a session reset occurred during the turn. */
  sessionReset: boolean;
  /** Fallback model used (if different from default). */
  fallbackModel?: string;
  /** Original default model. */
  defaultModel?: string;
};

/**
 * Record turn outcome for drift detection and coherence log.
 * Persists updated state to the session store.
 */
export async function persistDriftCoherenceUpdate(params: {
  storePath?: string;
  sessionKey?: string;
  signals: TurnCorrectionSignals;
  taskId?: string;
  toolMetas?: Array<{ toolName: string; meta?: string }>;
  /** Last tool error from the run attempt (for failure tracking). */
  lastToolError?: { toolName: string; meta?: string; error?: string };
}): Promise<void> {
  const { storePath, sessionKey, signals } = params;
  if (!storePath || !sessionKey) return;

  const now = Date.now();

  // Build correction event from turn signals
  const event: CorrectionEvent = {
    ts: now,
    modelFallback: signals.modelFallback || undefined,
    forcedCompaction: signals.autoCompaction || undefined,
    contextOverflow: signals.contextOverflow || undefined,
    sessionReset: signals.sessionReset || undefined,
  };

  try {
    await updateSessionStoreEntry({
      storePath,
      sessionKey,
      update: async (entry) => {
        // Update drift state
        const driftState = resolveDriftState({
          driftEvents: entry.driftEvents,
          driftBaselineRate: entry.driftBaselineRate,
          driftBaselineTurns: entry.driftBaselineTurns,
          driftLevel: entry.driftLevel,
          driftLevelChangedAt: entry.driftLevelChangedAt,
          driftResponseCount: entry.driftResponseCount,
        });
        const { next: nextDrift, levelChanged } = recordTurnOutcome(driftState, event);

        if (levelChanged && nextDrift.level !== "normal") {
          logVerbose(
            `[drift] Level changed to ${nextDrift.level} for session ${sessionKey} ` +
              `(rate threshold exceeded, response #${nextDrift.driftResponseCount})`,
          );
        }

        // Update coherence log with model switch if fallback occurred
        let coherenceState = resolveCoherenceLog({
          coherenceEntries: entry.coherenceEntries,
          coherencePinned: entry.coherencePinned,
        });
        if (signals.modelFallback && signals.fallbackModel) {
          const modelEntry = buildModelSwitchEntry({
            fromModel: signals.defaultModel,
            toModel: signals.fallbackModel,
            reason: "fallback",
            taskId: params.taskId,
            now,
          });
          coherenceState = appendCoherenceEntry(coherenceState, modelEntry);
        }

        // Append coherence entries for decision-making tool calls
        if (params.toolMetas) {
          for (const tm of params.toolMetas) {
            const entry = buildToolMetaCoherenceEntry({
              toolName: tm.toolName,
              meta: tm.meta,
              taskId: params.taskId,
              now,
            });
            if (entry) {
              coherenceState = appendCoherenceEntry(coherenceState, entry);
            }
          }
        }

        // RSC v2.1: Update tool failure tracking
        let toolFailureState = resolveToolFailureState({ toolFailures: entry.toolFailures });
        let failureSigs = resolveFailureSignatures({ failureSignatures: entry.failureSignatures });

        // Record last tool error as a failure
        if (params.lastToolError) {
          const { toolName, error } = params.lastToolError;
          toolFailureState = recordToolOutcome(toolFailureState, toolName, false, error, now);
          if (error) {
            failureSigs = recordFailureSignature(failureSigs, toolName, error, now);
          }
        }

        // Record successful tool calls (resets consecutive failure count)
        if (params.toolMetas) {
          for (const tm of params.toolMetas) {
            // If this tool isn't the failed one, it succeeded
            if (!params.lastToolError || tm.toolName !== params.lastToolError.toolName) {
              toolFailureState = recordToolOutcome(
                toolFailureState,
                tm.toolName,
                true,
                undefined,
                now,
              );
            }
          }
        }

        const patch: Partial<SessionEntry> = {
          driftEvents: nextDrift.events,
          driftBaselineRate: nextDrift.baselineRate,
          driftBaselineTurns: nextDrift.baselineTurns,
          driftLevel: nextDrift.level,
          driftLevelChangedAt: nextDrift.levelChangedAt,
          driftResponseCount: nextDrift.driftResponseCount,
          coherenceEntries: coherenceState.entries,
          coherencePinned: coherenceState.pinned,
          toolFailures: toolFailureState.records,
          failureSignatures: failureSigs,
          updatedAt: now,
        };

        return patch;
      },
    });
  } catch (err) {
    logVerbose(`[drift] Failed to persist drift/coherence update: ${String(err)}`);
  }
}

/**
 * Resolve drift prompt injection for the current session.
 * Called before building the system prompt to inject stability warnings.
 */
export function resolveDriftInjectionForSession(
  entry?: SessionEntry,
): ReturnType<typeof buildDriftPromptInjection> {
  if (!entry) return null;
  const state = resolveDriftState({
    driftEvents: entry.driftEvents,
    driftBaselineRate: entry.driftBaselineRate,
    driftBaselineTurns: entry.driftBaselineTurns,
    driftLevel: entry.driftLevel,
    driftLevelChangedAt: entry.driftLevelChangedAt,
    driftResponseCount: entry.driftResponseCount,
  });
  return buildDriftPromptInjection(state);
}
