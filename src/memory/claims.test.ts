import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  normalizeClaimText,
  generateClaimId,
  upsertClaim,
  getClaim,
  listClaims,
  updateClaimStatus,
  deleteClaim,
  searchClaimsByVector,
  type ClaimRecord,
} from "./claims.js";
import { ensureMemoryIndexSchema } from "./memory-schema.js";

let db: import("node:sqlite").DatabaseSync;

beforeAll(async () => {
  const { DatabaseSync } = await import("node:sqlite");
  db = new DatabaseSync(":memory:");
  ensureMemoryIndexSchema({
    db,
    embeddingCacheTable: "embedding_cache",
    ftsTable: "chunks_fts",
    ftsEnabled: false,
  });
});

afterAll(() => {
  db?.close();
});

describe("normalizeClaimText", () => {
  it("collapses whitespace, trims, and lowercases", () => {
    expect(normalizeClaimText("  Hello   World  ")).toBe("hello world");
    expect(normalizeClaimText("FOO\n\tbar")).toBe("foo bar");
  });
});

describe("generateClaimId", () => {
  it("produces deterministic IDs", () => {
    const a = generateClaimId("test claim", "global");
    const b = generateClaimId("test claim", "global");
    expect(a).toBe(b);
    expect(a).toMatch(/^claim_[a-f0-9]{16}$/);
  });

  it("produces same ID for whitespace-variant texts (canonicalization)", () => {
    const a = generateClaimId("  test  claim  ", "global");
    const b = generateClaimId("test claim", "global");
    expect(a).toBe(b);
  });

  it("produces different IDs for different scopes", () => {
    const global = generateClaimId("same text", "global");
    const task = generateClaimId("same text", "task", "task-1");
    expect(global).not.toBe(task);
  });

  it("produces different IDs for different task IDs", () => {
    const a = generateClaimId("same text", "task", "task-1");
    const b = generateClaimId("same text", "task", "task-2");
    expect(a).not.toBe(b);
  });
});

describe("CRUD operations", () => {
  const now = Date.now();

  it("upserts and gets a claim", () => {
    const claim: ClaimRecord = {
      id: generateClaimId("test upsert", "global"),
      text: "test upsert",
      claimType: "fact",
      scope: "global",
      status: "unverified",
      confidence: 0.8,
      evidenceRefs: ["evt_001"],
      createdAt: now,
      updatedAt: now,
    };
    upsertClaim(db, claim);
    const retrieved = getClaim(db, claim.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.text).toBe("test upsert");
    expect(retrieved!.claimType).toBe("fact");
    expect(retrieved!.confidence).toBe(0.8);
    expect(retrieved!.evidenceRefs).toEqual(["evt_001"]);
  });

  it("upserts idempotently (updates updatedAt)", () => {
    const id = generateClaimId("idempotent test", "global");
    const claim: ClaimRecord = {
      id,
      text: "idempotent test",
      claimType: "decision",
      scope: "global",
      status: "unverified",
      confidence: 0.7,
      evidenceRefs: [],
      createdAt: now,
      updatedAt: now,
    };
    upsertClaim(db, claim);
    const updated = { ...claim, updatedAt: now + 1000, confidence: 0.9 };
    upsertClaim(db, updated);
    const retrieved = getClaim(db, id);
    expect(retrieved!.confidence).toBe(0.9);
    expect(retrieved!.updatedAt).toBe(now + 1000);
  });

  it("lists claims with filters", () => {
    const taskClaim: ClaimRecord = {
      id: generateClaimId("task specific", "task", "task-a"),
      text: "task specific",
      claimType: "rule",
      scope: "task",
      taskId: "task-a",
      status: "verified",
      confidence: 0.95,
      evidenceRefs: [],
      createdAt: now,
      updatedAt: now,
    };
    upsertClaim(db, taskClaim);

    const all = listClaims(db);
    expect(all.length).toBeGreaterThanOrEqual(1);

    const taskOnly = listClaims(db, { taskId: "task-a" });
    expect(taskOnly.some((c) => c.id === taskClaim.id)).toBe(true);

    const rules = listClaims(db, { claimType: "rule" });
    expect(rules.some((c) => c.id === taskClaim.id)).toBe(true);

    const verified = listClaims(db, { status: "verified" });
    expect(verified.some((c) => c.id === taskClaim.id)).toBe(true);
  });

  it("updates claim status", () => {
    const id = generateClaimId("status test", "global");
    upsertClaim(db, {
      id,
      text: "status test",
      claimType: "fact",
      scope: "global",
      status: "unverified",
      confidence: 0.5,
      evidenceRefs: [],
      createdAt: now,
      updatedAt: now,
    });

    const updated = updateClaimStatus(db, id, "verified", now + 5000);
    expect(updated).toBe(true);

    const retrieved = getClaim(db, id);
    expect(retrieved!.status).toBe("verified");
    expect(retrieved!.updatedAt).toBe(now + 5000);
  });

  it("deletes a claim", () => {
    const id = generateClaimId("delete test", "global");
    upsertClaim(db, {
      id,
      text: "delete test",
      claimType: "fact",
      scope: "global",
      status: "unverified",
      confidence: 0.5,
      evidenceRefs: [],
      createdAt: now,
      updatedAt: now,
    });
    expect(getClaim(db, id)).not.toBeNull();

    const deleted = deleteClaim(db, id);
    expect(deleted).toBe(true);
    expect(getClaim(db, id)).toBeNull();
  });

  it("returns false for non-existent delete/update", () => {
    expect(deleteClaim(db, "nonexistent")).toBe(false);
    expect(updateClaimStatus(db, "nonexistent", "verified")).toBe(false);
  });
});

describe("vector search", () => {
  it("finds claims by cosine similarity", () => {
    const now = Date.now();
    // Insert claims with known embeddings
    const claimA: ClaimRecord = {
      id: generateClaimId("vector claim A", "global"),
      text: "vector claim A",
      claimType: "fact",
      scope: "global",
      status: "unverified",
      confidence: 0.8,
      evidenceRefs: [],
      embedding: [1, 0, 0, 0],
      createdAt: now,
      updatedAt: now,
    };
    const claimB: ClaimRecord = {
      id: generateClaimId("vector claim B", "global"),
      text: "vector claim B",
      claimType: "decision",
      scope: "global",
      status: "unverified",
      confidence: 0.7,
      evidenceRefs: [],
      embedding: [0, 1, 0, 0],
      createdAt: now,
      updatedAt: now,
    };
    upsertClaim(db, claimA);
    upsertClaim(db, claimB);

    // Query vector close to claimA
    const results = searchClaimsByVector(db, [0.9, 0.1, 0, 0]);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]!.id).toBe(claimA.id);
    expect(results[0]!.similarityScore).toBeGreaterThan(0.8);
  });

  it("respects scope filter in vector search", () => {
    const now = Date.now();
    const taskClaim: ClaimRecord = {
      id: generateClaimId("scoped vector claim", "task", "task-v"),
      text: "scoped vector claim",
      claimType: "fact",
      scope: "task",
      taskId: "task-v",
      status: "unverified",
      confidence: 0.8,
      evidenceRefs: [],
      embedding: [0, 0, 1, 0],
      createdAt: now,
      updatedAt: now,
    };
    upsertClaim(db, taskClaim);

    const globalOnly = searchClaimsByVector(db, [0, 0, 0.9, 0.1], { scope: "global" });
    expect(globalOnly.some((c) => c.id === taskClaim.id)).toBe(false);

    const taskOnly = searchClaimsByVector(db, [0, 0, 0.9, 0.1], { taskId: "task-v" });
    expect(taskOnly.some((c) => c.id === taskClaim.id)).toBe(true);
  });

  it("returns empty for zero-length query vector", () => {
    const results = searchClaimsByVector(db, []);
    expect(results).toEqual([]);
  });
});
