import type { DatabaseSync } from "node:sqlite";
import type { MemoryPinRecord } from "./pins.js";
import type { TaskMemorySnapshot } from "./task-memory-merge.js";
import {
  type ClaimRecord,
  type ClaimScope,
  type ClaimType,
  generateClaimId,
  normalizeClaimText,
  upsertClaim,
  getClaim,
} from "./claims.js";

// ---------------------------------------------------------------------------
// Extraction from task memory snapshots
// ---------------------------------------------------------------------------

/**
 * Convert structured sections of a TaskMemorySnapshot into claims.
 * Deduplicates against `existingClaimIds` to avoid re-inserting known claims.
 */
export function extractClaimsFromSnapshot(params: {
  db: DatabaseSync;
  snapshot: TaskMemorySnapshot;
  scope: ClaimScope;
  taskId?: string;
  existingClaimIds?: Set<string>;
  now?: number;
}): ClaimRecord[] {
  const { db, snapshot, scope, taskId, now = Date.now() } = params;
  const existing = params.existingClaimIds ?? new Set<string>();
  const claims: ClaimRecord[] = [];

  // Decisions → type "decision", confidence 0.7
  for (const text of snapshot.decisions) {
    const claim = buildClaim({
      text,
      claimType: "decision",
      scope,
      taskId,
      confidence: 0.7,
      now,
    });
    if (claim && !existing.has(claim.id)) {
      claims.push(claim);
      existing.add(claim.id);
    }
  }

  // Open questions are NOT claims (they represent uncertainty, not assertions).

  // Key entities → type "fact", confidence 0.6
  for (const text of snapshot.keyEntities) {
    const claim = buildClaim({
      text,
      claimType: "fact",
      scope,
      taskId,
      confidence: 0.6,
      now,
    });
    if (claim && !existing.has(claim.id)) {
      claims.push(claim);
      existing.add(claim.id);
    }
  }

  // Pinned items → type from content heuristic, confidence 0.9
  for (const text of snapshot.pinned) {
    const claimType = inferClaimTypeFromPinText(text);
    const claim = buildClaim({
      text,
      claimType,
      scope,
      taskId,
      confidence: 0.9,
      now,
    });
    if (claim && !existing.has(claim.id)) {
      claims.push(claim);
      existing.add(claim.id);
    }
  }

  // Goal → type "decision", confidence 0.7
  if (snapshot.goal) {
    const claim = buildClaim({
      text: snapshot.goal,
      claimType: "decision",
      scope,
      taskId,
      confidence: 0.7,
      now,
    });
    if (claim && !existing.has(claim.id)) {
      claims.push(claim);
      existing.add(claim.id);
    }
  }

  return claims;
}

// ---------------------------------------------------------------------------
// Extraction from pin records
// ---------------------------------------------------------------------------

/**
 * Convert pin records into claims with appropriate types.
 * Deduplicates against `existingClaimIds`.
 */
export function extractClaimsFromPins(params: {
  db: DatabaseSync;
  pins: MemoryPinRecord[];
  existingClaimIds?: Set<string>;
  now?: number;
}): ClaimRecord[] {
  const { pins, now = Date.now() } = params;
  const existing = params.existingClaimIds ?? new Set<string>();
  const claims: ClaimRecord[] = [];

  for (const pin of pins) {
    const claimType = pinTypeToClaim(pin.type);
    const scope: ClaimScope = pin.scope;
    const claim = buildClaim({
      text: pin.text,
      claimType,
      scope,
      taskId: pin.taskId,
      confidence: 0.9,
      evidenceRefs: [pin.id],
      now,
    });
    if (claim && !existing.has(claim.id)) {
      claims.push(claim);
      existing.add(claim.id);
    }
  }

  return claims;
}

// ---------------------------------------------------------------------------
// Batch store helper
// ---------------------------------------------------------------------------

/**
 * Store extracted claims into the database, skipping claims whose
 * text is unchanged (deduplication via canonicalized ID).
 */
export function storeExtractedClaims(db: DatabaseSync, claims: ClaimRecord[]): number {
  let stored = 0;
  for (const claim of claims) {
    const existing = getClaim(db, claim.id);
    if (existing && normalizeClaimText(existing.text) === normalizeClaimText(claim.text)) {
      // Same canonical text — skip (idempotent).
      continue;
    }
    upsertClaim(db, claim);
    stored += 1;
  }
  return stored;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildClaim(params: {
  text: string;
  claimType: ClaimType;
  scope: ClaimScope;
  taskId?: string;
  confidence: number;
  evidenceRefs?: string[];
  now: number;
}): ClaimRecord | null {
  const normalized = params.text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return null;
  }

  const id = generateClaimId(normalized, params.scope, params.taskId);
  return {
    id,
    text: normalized,
    claimType: params.claimType,
    scope: params.scope,
    taskId: params.taskId,
    status: "unverified",
    confidence: params.confidence,
    evidenceRefs: params.evidenceRefs ?? [],
    createdAt: params.now,
    updatedAt: params.now,
  };
}

function pinTypeToClaim(pinType: string): ClaimType {
  switch (pinType) {
    case "fact":
      return "fact";
    case "preference":
      return "preference";
    case "constraint":
      return "rule";
    case "temporary":
      return "fact";
    default:
      return "fact";
  }
}

function inferClaimTypeFromPinText(text: string): ClaimType {
  const lower = text.toLowerCase();
  if (/\b(must|never|always|require|constrain)\b/.test(lower)) {
    return "rule";
  }
  if (/\b(prefer|prefers|preferred|like|want|favor)\b/.test(lower)) {
    return "preference";
  }
  if (/\b(decided|decision|chose|chosen)\b/.test(lower)) {
    return "decision";
  }
  return "fact";
}
