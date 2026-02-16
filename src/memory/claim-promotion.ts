import type { DatabaseSync } from "node:sqlite";
import {
  type ClaimRecord,
  type ClaimStatus,
  getClaim,
  updateClaimStatus,
  upsertClaim,
} from "./claims.js";
import { getQaPair, updateQaFeedback } from "./qa-store.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FeedbackVerdict = "positive" | "negative" | "correction";

export type FeedbackResult = {
  qaId: string;
  feedback: FeedbackVerdict;
  correction?: string;
  claimUpdates: Array<{
    claimId: string;
    previousStatus: ClaimStatus;
    newStatus: ClaimStatus;
    previousConfidence: number;
    newConfidence: number;
  }>;
};

export type PromotionThresholds = {
  /** Minimum positive feedback count to auto-verify (default: 2) */
  positiveToVerify: number;
  /** Minimum negative feedback count to auto-dispute (default: 1) */
  negativeToDispute: number;
  /** Confidence boost per positive feedback (default: 0.15) */
  positiveConfidenceBoost: number;
  /** Confidence penalty per negative feedback (default: 0.25) */
  negativeConfidencePenalty: number;
  /** Confidence threshold above which claims auto-verify (default: 0.85) */
  autoVerifyThreshold: number;
  /** Confidence threshold below which claims auto-deprecate (default: 0.2) */
  autoDeprecateThreshold: number;
};

const DEFAULT_THRESHOLDS: PromotionThresholds = {
  positiveToVerify: 2,
  negativeToDispute: 1,
  positiveConfidenceBoost: 0.15,
  negativeConfidencePenalty: 0.25,
  autoVerifyThreshold: 0.85,
  autoDeprecateThreshold: 0.2,
};

// ---------------------------------------------------------------------------
// Feedback processing
// ---------------------------------------------------------------------------

/**
 * Process user feedback on a Q/A pair and promote/demote referenced claims.
 *
 * Steps:
 * 1. Look up the Q/A pair
 * 2. Record the feedback on it
 * 3. Resolve referenced claims
 * 4. Adjust confidence and potentially promote/demote status
 */
export function processQaFeedback(params: {
  db: DatabaseSync;
  qaId: string;
  feedback: FeedbackVerdict;
  correction?: string;
  thresholds?: Partial<PromotionThresholds>;
  now?: number;
}): FeedbackResult | null {
  const { db, qaId, feedback, correction } = params;
  const now = params.now ?? Date.now();
  const thresholds = { ...DEFAULT_THRESHOLDS, ...params.thresholds };

  const qa = getQaPair(db, qaId);
  if (!qa) {
    return null;
  }

  // Record feedback on the Q/A pair
  const feedbackText =
    feedback === "correction" ? `correction: ${correction ?? ""}` : feedback;
  updateQaFeedback(db, qaId, feedbackText, correction);

  // Process referenced claims
  const claimUpdates: FeedbackResult["claimUpdates"] = [];
  for (const claimId of qa.claimRefs) {
    const claim = getClaim(db, claimId);
    if (!claim) continue;

    const updated = applyFeedbackToClaim({
      claim,
      feedback,
      thresholds,
      now,
    });
    if (updated) {
      // Update confidence via upsert (updateClaimStatus only changes status)
      upsertClaim(db, { ...claim, confidence: updated.newConfidence, updatedAt: now });
      if (updated.newStatus !== claim.status) {
        updateClaimStatus(db, claimId, updated.newStatus, now);
      }
      claimUpdates.push({
        claimId,
        previousStatus: claim.status,
        newStatus: updated.newStatus,
        previousConfidence: claim.confidence,
        newConfidence: updated.newConfidence,
      });
    }
  }

  return { qaId, feedback, correction, claimUpdates };
}

// ---------------------------------------------------------------------------
// Direct claim feedback (not via Q/A pair)
// ---------------------------------------------------------------------------

/**
 * Apply feedback directly to a claim without going through a Q/A pair.
 */
export function processClaimFeedback(params: {
  db: DatabaseSync;
  claimId: string;
  feedback: FeedbackVerdict;
  thresholds?: Partial<PromotionThresholds>;
  now?: number;
}): FeedbackResult["claimUpdates"][number] | null {
  const { db, claimId, feedback } = params;
  const now = params.now ?? Date.now();
  const thresholds = { ...DEFAULT_THRESHOLDS, ...params.thresholds };

  const claim = getClaim(db, claimId);
  if (!claim) return null;

  const updated = applyFeedbackToClaim({ claim, feedback, thresholds, now });
  if (!updated) return null;

  upsertClaim(db, { ...claim, confidence: updated.newConfidence, updatedAt: now });
  if (updated.newStatus !== claim.status) {
    updateClaimStatus(db, claimId, updated.newStatus, now);
  }

  return {
    claimId,
    previousStatus: claim.status,
    newStatus: updated.newStatus,
    previousConfidence: claim.confidence,
    newConfidence: updated.newConfidence,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function applyFeedbackToClaim(params: {
  claim: ClaimRecord;
  feedback: FeedbackVerdict;
  thresholds: PromotionThresholds;
  now: number;
}): { newStatus: ClaimStatus; newConfidence: number } | null {
  const { claim, feedback, thresholds } = params;

  // Don't modify already-deprecated claims
  if (claim.status === "deprecated") {
    return null;
  }

  let newConfidence = claim.confidence;
  let newStatus: ClaimStatus = claim.status;

  if (feedback === "positive") {
    newConfidence = Math.min(1, newConfidence + thresholds.positiveConfidenceBoost);
    if (newConfidence >= thresholds.autoVerifyThreshold && claim.status !== "verified") {
      newStatus = "verified";
    }
  } else if (feedback === "negative" || feedback === "correction") {
    newConfidence = Math.max(0, newConfidence - thresholds.negativeConfidencePenalty);
    if (claim.status === "verified") {
      newStatus = "disputed";
    } else if (newConfidence <= thresholds.autoDeprecateThreshold) {
      newStatus = "deprecated";
    } else if (claim.status === "unverified") {
      newStatus = "disputed";
    }
  }

  // No change
  if (newConfidence === claim.confidence && newStatus === claim.status) {
    return null;
  }

  return { newStatus, newConfidence };
}

/**
 * Compute promotion eligibility for a claim based on accumulated feedback.
 * Returns the recommended status and confidence, without applying changes.
 */
export function evaluateClaimPromotion(params: {
  claim: ClaimRecord;
  positiveCount: number;
  negativeCount: number;
  thresholds?: Partial<PromotionThresholds>;
}): { recommendedStatus: ClaimStatus; recommendedConfidence: number } {
  const thresholds = { ...DEFAULT_THRESHOLDS, ...params.thresholds };
  const { claim, positiveCount, negativeCount } = params;

  let confidence = claim.confidence;
  confidence += positiveCount * thresholds.positiveConfidenceBoost;
  confidence -= negativeCount * thresholds.negativeConfidencePenalty;
  confidence = Math.max(0, Math.min(1, confidence));

  let status = claim.status;
  if (confidence >= thresholds.autoVerifyThreshold) {
    status = "verified";
  } else if (confidence <= thresholds.autoDeprecateThreshold) {
    status = "deprecated";
  } else if (negativeCount >= thresholds.negativeToDispute && status !== "verified") {
    status = "disputed";
  }

  return { recommendedStatus: status, recommendedConfidence: confidence };
}

// ---------------------------------------------------------------------------
// Implicit Claim Acceptance — Learnability P1
// ---------------------------------------------------------------------------

/**
 * Implicit acceptance boost amount (vs +0.15 for explicit positive feedback).
 * Smaller to reflect lower confidence in silent acceptance.
 */
const IMPLICIT_BOOST = 0.05;

/**
 * Maximum confidence reachable via implicit acceptance alone.
 * Claims cannot be auto-promoted to `verified` without explicit positive feedback.
 */
const IMPLICIT_MAX_CONFIDENCE = 0.7;

/**
 * Minimum confidence a claim must have before implicit acceptance applies.
 * Prevents reinforcing hallucinated/low-quality claims.
 */
const IMPLICIT_MIN_CONFIDENCE_GATE = 0.3;

/**
 * Apply implicit acceptance boost to a claim.
 *
 * Guardrails:
 * (a) Confidence gate: only apply to claims already above 0.3 confidence
 * (b) Multi-turn validation: caller must verify non-dispute across 2+ consecutive turns
 * (c) Retrieval-confirmed: caller must confirm claim was retrieved via memory_search
 * (d) Cap: cannot reach `verified` status; max confidence 0.7
 *
 * @param params.db - Database handle
 * @param params.claimId - The claim to boost
 * @param params.wasRetrieved - Whether claim was retrieved via memory_search (not fabricated)
 * @param params.consecutiveNonDisputeTurns - Number of consecutive turns without dispute
 * @param params.now - Optional timestamp for testing
 */
export function applyImplicitAcceptance(params: {
  db: DatabaseSync;
  claimId: string;
  wasRetrieved: boolean;
  consecutiveNonDisputeTurns: number;
  now?: number;
}): { applied: boolean; reason?: string; newConfidence?: number } {
  const { db, claimId, wasRetrieved, consecutiveNonDisputeTurns } = params;
  const now = params.now ?? Date.now();

  // Guardrail (c): Must have been retrieved via memory_search
  if (!wasRetrieved) {
    return { applied: false, reason: "Claim was not retrieved via memory_search" };
  }

  // Guardrail (b): Multi-turn validation — require 2+ consecutive non-dispute turns
  if (consecutiveNonDisputeTurns < 2) {
    return { applied: false, reason: `Only ${consecutiveNonDisputeTurns} non-dispute turns (need 2)` };
  }

  const claim = getClaim(db, claimId);
  if (!claim) {
    return { applied: false, reason: "Claim not found" };
  }

  // Don't modify deprecated claims
  if (claim.status === "deprecated") {
    return { applied: false, reason: "Claim is deprecated" };
  }

  // Guardrail (a): Confidence gate
  if (claim.confidence < IMPLICIT_MIN_CONFIDENCE_GATE) {
    return { applied: false, reason: `Confidence ${claim.confidence} below gate ${IMPLICIT_MIN_CONFIDENCE_GATE}` };
  }

  // Guardrail (d): Cap at IMPLICIT_MAX_CONFIDENCE
  const newConfidence = Math.min(IMPLICIT_MAX_CONFIDENCE, claim.confidence + IMPLICIT_BOOST);

  // No change
  if (newConfidence === claim.confidence) {
    return { applied: false, reason: "Already at implicit confidence cap" };
  }

  // Guardrail (d): Cannot promote to verified via implicit acceptance
  // Status stays as-is; only confidence changes
  upsertClaim(db, { ...claim, confidence: newConfidence, updatedAt: now });

  return { applied: true, newConfidence };
}
