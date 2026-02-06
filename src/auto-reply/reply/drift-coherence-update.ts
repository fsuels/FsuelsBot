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
  buildSystemEventEntry,
  buildUserCorrectionEntry,
  EventVerb,
  evaluatePromotionCandidates,
} from "../../agents/coherence-log.js";
import {
  resolveToolFailureState,
  recordToolOutcome,
  recordFailureSignature,
  resolveFailureSignatures,
} from "../../agents/tool-failure-tracker.js";
import { resolveCapabilityLedger, upsertCapability } from "../../agents/capability-ledger.js";
import { updateSessionStoreEntry, type SessionEntry } from "../../config/sessions.js";
import { resolveThreadParentSessionKey } from "../../sessions/session-key-utils.js";
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
/** Tool calls per turn above which a complexity/thrashing signal is emitted. */
const TURN_COMPLEXITY_THRESHOLD = 8;

export async function persistDriftCoherenceUpdate(params: {
  storePath?: string;
  sessionKey?: string;
  signals: TurnCorrectionSignals;
  taskId?: string;
  toolMetas?: Array<{ toolName: string; meta?: string }>;
  /** Last tool error from the run attempt (for failure tracking). */
  lastToolError?: { toolName: string; meta?: string; error?: string };
  /** User message text when a correction was detected (RSC v3.1-patch). */
  userCorrectionHint?: string;
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

        // RSC v3.1-patch: Record user correction as REJECTED event
        if (params.userCorrectionHint) {
          coherenceState = appendCoherenceEntry(
            coherenceState,
            buildUserCorrectionEntry({
              messagePreview: params.userCorrectionHint,
              taskId: params.taskId,
              now,
            }),
          );
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

        // RSC v3.1-patch: Flag turn complexity (thrashing detection)
        const toolCallCount = params.toolMetas?.length ?? 0;
        if (toolCallCount >= TURN_COMPLEXITY_THRESHOLD) {
          coherenceState = appendCoherenceEntry(
            coherenceState,
            buildSystemEventEntry({
              verb: EventVerb.BLOCKED,
              subject: "turn complexity",
              outcome: `${toolCallCount} tool calls`,
              taskId: params.taskId,
              now,
            }),
          );
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
          // RSC v3.0: Log structured FAILED event
          coherenceState = appendCoherenceEntry(
            coherenceState,
            buildSystemEventEntry({
              verb: EventVerb.FAILED,
              subject: toolName,
              outcome: (error ?? "unknown error").slice(0, 80),
              taskId: params.taskId,
              now,
            }),
          );
        }

        // RSC v3.0: Log structured system events for turn-level signals
        if (signals.autoCompaction) {
          coherenceState = appendCoherenceEntry(
            coherenceState,
            buildSystemEventEntry({
              verb: EventVerb.COMPACTED,
              subject: "session",
              outcome: "auto-compacted",
              taskId: params.taskId,
              now,
            }),
          );
        }
        if (signals.contextOverflow) {
          coherenceState = appendCoherenceEntry(
            coherenceState,
            buildSystemEventEntry({
              verb: EventVerb.BLOCKED,
              subject: "context",
              outcome: "overflow",
              taskId: params.taskId,
              now,
            }),
          );
        }
        if (signals.sessionReset) {
          coherenceState = appendCoherenceEntry(
            coherenceState,
            buildSystemEventEntry({
              verb: EventVerb.REJECTED,
              subject: "session",
              outcome: "user reset",
              taskId: params.taskId,
              now,
            }),
          );
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

        // RSC v3.2: Update capability ledger from successful tool calls
        let capabilityLedger = resolveCapabilityLedger({
          capabilityLedger: entry.capabilityLedger,
        });
        if (params.toolMetas) {
          const failedTool = params.lastToolError?.toolName;
          for (const tm of params.toolMetas) {
            if (tm.toolName !== failedTool) {
              capabilityLedger = upsertCapability(capabilityLedger, tm.toolName, tm.meta, now);
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
          capabilityLedger,
          updatedAt: now,
        };

        return patch;
      },
    });
  } catch (err) {
    logVerbose(`[drift] Failed to persist drift/coherence update: ${String(err)}`);
  }

  // RSC v3.1: Evaluate promotion candidates on parent/agent-level session
  try {
    const parentKey = resolveThreadParentSessionKey(sessionKey) ?? sessionKey;
    if (parentKey) {
      await updateSessionStoreEntry({
        storePath,
        sessionKey: parentKey,
        update: async (parentEntry) => {
          const coherenceState = resolveCoherenceLog({
            coherenceEntries: params.toolMetas
              ? params.toolMetas
                  .map((tm) =>
                    buildToolMetaCoherenceEntry({
                      toolName: tm.toolName,
                      meta: tm.meta,
                      taskId: params.taskId,
                      now,
                    }),
                  )
                  .filter(Boolean)
              : [],
            coherencePinned: [],
          });

          // Also include system events from this turn
          const turnEvents = coherenceState.entries;
          if (params.lastToolError) {
            turnEvents.push(
              buildSystemEventEntry({
                verb: EventVerb.FAILED,
                subject: params.lastToolError.toolName,
                outcome: (params.lastToolError.error ?? "unknown error").slice(0, 80),
                taskId: params.taskId,
                now,
              }),
            );
          }

          if (turnEvents.length === 0) return null;

          const { candidates, promoted } = evaluatePromotionCandidates({
            sessionKey,
            events: turnEvents,
            pinned: [],
            existingCandidates: parentEntry.promotionCandidates ?? [],
            existingPromoted: parentEntry.promotedEvents ?? [],
            now,
          });

          // Only persist if something changed
          const candidatesChanged =
            candidates.length !== (parentEntry.promotionCandidates ?? []).length;
          const promotedChanged = promoted.length !== (parentEntry.promotedEvents ?? []).length;
          if (!candidatesChanged && !promotedChanged) return null;

          return {
            promotionCandidates: candidates,
            promotedEvents: promoted,
          };
        },
      });
    }
  } catch (err) {
    logVerbose(`[drift] Failed to evaluate promotion candidates: ${String(err)}`);
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
