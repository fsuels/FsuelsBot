import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureMemoryIndexSchema } from "./memory-schema.js";
import { type ClaimRecord, getClaim, upsertClaim } from "./claims.js";
import { storeQaPair, getQaPair } from "./qa-store.js";
import {
  evaluateClaimPromotion,
  processClaimFeedback,
  processQaFeedback,
} from "./claim-promotion.js";

describe("claim promotion", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    ensureMemoryIndexSchema({
      db,
      embeddingCacheTable: "embedding_cache",
      ftsTable: "chunks_fts",
      ftsEnabled: false,
    });
  });

  afterEach(() => {
    db.close();
  });

  function seedClaim(overrides: Partial<ClaimRecord> = {}): ClaimRecord {
    const now = Date.now();
    const claim: ClaimRecord = {
      id: overrides.id ?? "claim_test_01",
      text: overrides.text ?? "TypeScript is preferred",
      claimType: overrides.claimType ?? "preference",
      scope: overrides.scope ?? "global",
      status: overrides.status ?? "unverified",
      confidence: overrides.confidence ?? 0.5,
      evidenceRefs: overrides.evidenceRefs ?? [],
      createdAt: overrides.createdAt ?? now,
      updatedAt: overrides.updatedAt ?? now,
      ...overrides,
    };
    upsertClaim(db, claim);
    return claim;
  }

  function seedQaWithClaim(): { qaId: string; claimId: string } {
    const claim = seedClaim({ id: "claim_qa_linked", confidence: 0.5 });
    const qaId = storeQaPair(db, {
      question: "What language to use?",
      answer: "TypeScript is preferred",
      claimRefs: [claim.id],
      chunkRefs: [],
      createdAt: Date.now(),
    });
    return { qaId, claimId: claim.id };
  }

  describe("processQaFeedback", () => {
    it("returns null for unknown Q/A pair", () => {
      const result = processQaFeedback({
        db,
        qaId: "qa_nonexistent",
        feedback: "positive",
      });
      expect(result).toBeNull();
    });

    it("records positive feedback and boosts referenced claim confidence", () => {
      const { qaId, claimId } = seedQaWithClaim();
      const result = processQaFeedback({ db, qaId, feedback: "positive" });
      expect(result).not.toBeNull();
      expect(result!.feedback).toBe("positive");
      expect(result!.claimUpdates).toHaveLength(1);
      expect(result!.claimUpdates[0]!.previousConfidence).toBe(0.5);
      expect(result!.claimUpdates[0]!.newConfidence).toBe(0.65); // 0.5 + 0.15

      const claim = getClaim(db, claimId);
      expect(claim!.confidence).toBe(0.65);
    });

    it("records negative feedback and demotes claim to disputed", () => {
      const { qaId, claimId } = seedQaWithClaim();
      const result = processQaFeedback({ db, qaId, feedback: "negative" });
      expect(result).not.toBeNull();
      expect(result!.claimUpdates[0]!.newStatus).toBe("disputed");
      expect(result!.claimUpdates[0]!.newConfidence).toBe(0.25); // 0.5 - 0.25

      const claim = getClaim(db, claimId);
      expect(claim!.status).toBe("disputed");
    });

    it("records correction feedback on Q/A pair", () => {
      const { qaId } = seedQaWithClaim();
      const result = processQaFeedback({
        db,
        qaId,
        feedback: "correction",
        correction: "Actually use Python",
      });
      expect(result).not.toBeNull();

      const qa = getQaPair(db, qaId);
      expect(qa!.feedback).toBe("correction: Actually use Python");
      expect(qa!.correction).toBe("Actually use Python");
    });

    it("auto-verifies claim when confidence crosses threshold", () => {
      const claim = seedClaim({ id: "claim_high", confidence: 0.75 });
      const qaId = storeQaPair(db, {
        question: "Is this verified?",
        answer: "High confidence answer",
        claimRefs: [claim.id],
        chunkRefs: [],
        createdAt: Date.now(),
      });

      const result = processQaFeedback({ db, qaId, feedback: "positive" });
      expect(result!.claimUpdates[0]!.newStatus).toBe("verified");
      expect(result!.claimUpdates[0]!.newConfidence).toBe(0.9); // 0.75 + 0.15
    });

    it("auto-deprecates claim when confidence drops below threshold", () => {
      const claim = seedClaim({ id: "claim_low", confidence: 0.3 });
      const qaId = storeQaPair(db, {
        question: "Is this valid?",
        answer: "Low confidence answer",
        claimRefs: [claim.id],
        chunkRefs: [],
        createdAt: Date.now(),
      });

      const result = processQaFeedback({ db, qaId, feedback: "negative" });
      // 0.3 - 0.25 = 0.05, below 0.2 threshold
      expect(result!.claimUpdates[0]!.newConfidence).toBeCloseTo(0.05);
      expect(result!.claimUpdates[0]!.newStatus).toBe("deprecated");
    });

    it("processes multiple claim refs from single Q/A pair", () => {
      const claim1 = seedClaim({ id: "claim_multi_1", confidence: 0.5 });
      const claim2 = seedClaim({ id: "claim_multi_2", confidence: 0.7 });
      const qaId = storeQaPair(db, {
        question: "Multiple claims",
        answer: "Multi-ref answer",
        claimRefs: [claim1.id, claim2.id],
        chunkRefs: [],
        createdAt: Date.now(),
      });

      const result = processQaFeedback({ db, qaId, feedback: "positive" });
      expect(result!.claimUpdates).toHaveLength(2);
      expect(getClaim(db, claim1.id)!.confidence).toBe(0.65);
      expect(getClaim(db, claim2.id)!.confidence).toBe(0.85);
    });

    it("skips claim refs that no longer exist", () => {
      const claim = seedClaim({ id: "claim_exists" });
      const qaId = storeQaPair(db, {
        question: "Partial refs",
        answer: "Some refs missing",
        claimRefs: ["claim_deleted", claim.id],
        chunkRefs: [],
        createdAt: Date.now(),
      });

      const result = processQaFeedback({ db, qaId, feedback: "positive" });
      expect(result!.claimUpdates).toHaveLength(1);
      expect(result!.claimUpdates[0]!.claimId).toBe("claim_exists");
    });
  });

  describe("processClaimFeedback", () => {
    it("returns null for unknown claim", () => {
      const result = processClaimFeedback({
        db,
        claimId: "claim_nonexistent",
        feedback: "positive",
      });
      expect(result).toBeNull();
    });

    it("boosts confidence on positive feedback", () => {
      seedClaim({ id: "claim_direct", confidence: 0.6 });
      const result = processClaimFeedback({
        db,
        claimId: "claim_direct",
        feedback: "positive",
      });
      expect(result).not.toBeNull();
      expect(result!.newConfidence).toBe(0.75);
    });

    it("does not modify deprecated claims", () => {
      seedClaim({ id: "claim_deprecated", status: "deprecated", confidence: 0.1 });
      const result = processClaimFeedback({
        db,
        claimId: "claim_deprecated",
        feedback: "positive",
      });
      expect(result).toBeNull();
    });

    it("disputes verified claim on negative feedback", () => {
      seedClaim({ id: "claim_verified", status: "verified", confidence: 0.9 });
      const result = processClaimFeedback({
        db,
        claimId: "claim_verified",
        feedback: "negative",
      });
      expect(result).not.toBeNull();
      expect(result!.newStatus).toBe("disputed");
      expect(result!.newConfidence).toBe(0.65);
    });

    it("respects custom thresholds", () => {
      seedClaim({ id: "claim_custom", confidence: 0.5 });
      const result = processClaimFeedback({
        db,
        claimId: "claim_custom",
        feedback: "positive",
        thresholds: {
          positiveConfidenceBoost: 0.4,
          autoVerifyThreshold: 0.8,
        },
      });
      expect(result).not.toBeNull();
      expect(result!.newConfidence).toBe(0.9);
      expect(result!.newStatus).toBe("verified");
    });

    it("clamps confidence to [0, 1] range", () => {
      seedClaim({ id: "claim_high", confidence: 0.95 });
      const result = processClaimFeedback({
        db,
        claimId: "claim_high",
        feedback: "positive",
      });
      expect(result!.newConfidence).toBe(1);

      seedClaim({ id: "claim_low", confidence: 0.05 });
      const result2 = processClaimFeedback({
        db,
        claimId: "claim_low",
        feedback: "negative",
      });
      expect(result2!.newConfidence).toBe(0);
    });
  });

  describe("evaluateClaimPromotion", () => {
    it("recommends verified for sufficient positive feedback", () => {
      const claim = seedClaim({ confidence: 0.5 });
      const result = evaluateClaimPromotion({
        claim,
        positiveCount: 3,
        negativeCount: 0,
      });
      // 0.5 + 3*0.15 = 0.95, above 0.85 threshold
      expect(result.recommendedStatus).toBe("verified");
      expect(result.recommendedConfidence).toBe(0.95);
    });

    it("recommends deprecated for excessive negative feedback", () => {
      const claim = seedClaim({ confidence: 0.5 });
      const result = evaluateClaimPromotion({
        claim,
        positiveCount: 0,
        negativeCount: 3,
      });
      // 0.5 - 3*0.25 = -0.25, clamped to 0
      expect(result.recommendedStatus).toBe("deprecated");
      expect(result.recommendedConfidence).toBe(0);
    });

    it("recommends disputed for mixed feedback below verify threshold", () => {
      const claim = seedClaim({ confidence: 0.5 });
      const result = evaluateClaimPromotion({
        claim,
        positiveCount: 1,
        negativeCount: 1,
      });
      // 0.5 + 0.15 - 0.25 = 0.4
      expect(result.recommendedStatus).toBe("disputed");
      expect(result.recommendedConfidence).toBeCloseTo(0.4);
    });

    it("keeps current status when no feedback", () => {
      const claim = seedClaim({ status: "unverified", confidence: 0.5 });
      const result = evaluateClaimPromotion({
        claim,
        positiveCount: 0,
        negativeCount: 0,
      });
      expect(result.recommendedStatus).toBe("unverified");
      expect(result.recommendedConfidence).toBe(0.5);
    });
  });
});
