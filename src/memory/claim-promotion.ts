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
  let newStatus = claim.status;

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
