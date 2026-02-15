import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MemoryPinRecord } from "./pins.js";
import type { TaskMemorySnapshot } from "./task-memory-merge.js";
import {
  extractClaimsFromSnapshot,
  extractClaimsFromPins,
  storeExtractedClaims,
} from "./claims-extraction.js";
import { generateClaimId, getClaim } from "./claims.js";
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

describe("extractClaimsFromSnapshot", () => {
  it("extracts decisions as decision claims with confidence 0.7", () => {
    const snapshot: TaskMemorySnapshot = {
      decisions: ["Use PostgreSQL for data storage", "Deploy to AWS"],
      openQuestions: [],
      nextActions: [],
      keyEntities: [],
      pinned: [],
      notes: [],
    };
    const claims = extractClaimsFromSnapshot({
      db,
      snapshot,
      scope: "global",
    });
    expect(claims).toHaveLength(2);
    expect(claims[0]!.claimType).toBe("decision");
    expect(claims[0]!.confidence).toBe(0.7);
    expect(claims[0]!.text).toBe("Use PostgreSQL for data storage");
  });

  it("extracts goal as a decision claim", () => {
    const snapshot: TaskMemorySnapshot = {
      goal: "Migrate to microservices architecture",
      decisions: [],
      openQuestions: [],
      nextActions: [],
      keyEntities: [],
      pinned: [],
      notes: [],
    };
    const claims = extractClaimsFromSnapshot({
      db,
      snapshot,
      scope: "task",
      taskId: "task-goal",
    });
    expect(claims).toHaveLength(1);
    expect(claims[0]!.claimType).toBe("decision");
    expect(claims[0]!.text).toBe("Migrate to microservices architecture");
    expect(claims[0]!.taskId).toBe("task-goal");
  });

  it("extracts key entities as fact claims with confidence 0.6", () => {
    const snapshot: TaskMemorySnapshot = {
      decisions: [],
      openQuestions: [],
      nextActions: [],
      keyEntities: ["UserService", "PaymentGateway"],
      pinned: [],
      notes: [],
    };
    const claims = extractClaimsFromSnapshot({
      db,
      snapshot,
      scope: "global",
    });
    expect(claims).toHaveLength(2);
    for (const claim of claims) {
      expect(claim.claimType).toBe("fact");
      expect(claim.confidence).toBe(0.6);
    }
  });

  it("extracts pinned items with appropriate type inference", () => {
    const snapshot: TaskMemorySnapshot = {
      decisions: [],
      openQuestions: [],
      nextActions: [],
      keyEntities: [],
      pinned: ["Must always validate inputs", "User prefers dark mode", "Server IP is 10.0.0.1"],
      notes: [],
    };
    const claims = extractClaimsFromSnapshot({
      db,
      snapshot,
      scope: "global",
    });
    expect(claims).toHaveLength(3);
    expect(claims[0]!.claimType).toBe("rule"); // "Must" → rule
    expect(claims[1]!.claimType).toBe("preference"); // "prefers" → preference
    expect(claims[2]!.claimType).toBe("fact"); // default → fact
    for (const claim of claims) {
      expect(claim.confidence).toBe(0.9);
    }
  });

  it("deduplicates against existing claim IDs", () => {
    const snapshot: TaskMemorySnapshot = {
      decisions: ["Use PostgreSQL", "Use PostgreSQL"],
      openQuestions: [],
      nextActions: [],
      keyEntities: [],
      pinned: [],
      notes: [],
    };
    const claims = extractClaimsFromSnapshot({
      db,
      snapshot,
      scope: "global",
    });
    // Duplicate text produces same canonicalized ID, so only 1 result
    expect(claims).toHaveLength(1);
  });

  it("deduplicates against provided existing IDs", () => {
    const existing = new Set<string>();
    existing.add(generateClaimId("Known fact", "global"));
    const snapshot: TaskMemorySnapshot = {
      decisions: [],
      openQuestions: [],
      nextActions: [],
      keyEntities: ["Known fact"],
      pinned: [],
      notes: [],
    };
    const claims = extractClaimsFromSnapshot({
      db,
      snapshot,
      scope: "global",
      existingClaimIds: existing,
    });
    expect(claims).toHaveLength(0);
  });

  it("skips empty/whitespace-only texts", () => {
    const snapshot: TaskMemorySnapshot = {
      decisions: ["  ", ""],
      openQuestions: [],
      nextActions: [],
      keyEntities: [],
      pinned: [],
      notes: [],
    };
    const claims = extractClaimsFromSnapshot({
      db,
      snapshot,
      scope: "global",
    });
    expect(claims).toHaveLength(0);
  });

  it("does not extract open questions as claims", () => {
    const snapshot: TaskMemorySnapshot = {
      decisions: [],
      openQuestions: ["Should we use gRPC or REST?"],
      nextActions: [],
      keyEntities: [],
      pinned: [],
      notes: [],
    };
    const claims = extractClaimsFromSnapshot({
      db,
      snapshot,
      scope: "global",
    });
    expect(claims).toHaveLength(0);
  });
});

describe("extractClaimsFromPins", () => {
  const now = Date.now();

  it("converts pin records to claims", () => {
    const pins: MemoryPinRecord[] = [
      {
        id: "pin_001",
        type: "fact",
        scope: "global",
        text: "API rate limit is 1000/min",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "pin_002",
        type: "constraint",
        scope: "task",
        taskId: "task-b",
        text: "Must not exceed budget",
        createdAt: now,
        updatedAt: now,
      },
    ];

    const claims = extractClaimsFromPins({ db, pins });
    expect(claims).toHaveLength(2);
    expect(claims[0]!.claimType).toBe("fact");
    expect(claims[0]!.evidenceRefs).toEqual(["pin_001"]);
    expect(claims[0]!.confidence).toBe(0.9);
    expect(claims[1]!.claimType).toBe("rule"); // constraint → rule
    expect(claims[1]!.scope).toBe("task");
    expect(claims[1]!.taskId).toBe("task-b");
  });

  it("maps pin types to claim types correctly", () => {
    const pins: MemoryPinRecord[] = [
      { id: "p1", type: "fact", scope: "global", text: "fact pin", createdAt: now, updatedAt: now },
      {
        id: "p2",
        type: "preference",
        scope: "global",
        text: "pref pin",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "p3",
        type: "constraint",
        scope: "global",
        text: "constraint pin",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "p4",
        type: "temporary",
        scope: "global",
        text: "temp pin",
        createdAt: now,
        updatedAt: now,
      },
    ];
    const claims = extractClaimsFromPins({ db, pins });
    expect(claims[0]!.claimType).toBe("fact");
    expect(claims[1]!.claimType).toBe("preference");
    expect(claims[2]!.claimType).toBe("rule");
    expect(claims[3]!.claimType).toBe("fact"); // temporary → fact
  });
});

describe("storeExtractedClaims", () => {
  it("stores new claims and skips duplicates", () => {
    const now = Date.now();
    const snapshot: TaskMemorySnapshot = {
      decisions: ["Store claim test"],
      openQuestions: [],
      nextActions: [],
      keyEntities: [],
      pinned: [],
      notes: [],
    };
    const claims = extractClaimsFromSnapshot({
      db,
      snapshot,
      scope: "global",
      now,
    });
    expect(claims).toHaveLength(1);

    const stored1 = storeExtractedClaims(db, claims);
    expect(stored1).toBe(1);

    // Second call should skip (idempotent)
    const stored2 = storeExtractedClaims(db, claims);
    expect(stored2).toBe(0);

    // Verify in DB
    const retrieved = getClaim(db, claims[0]!.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.text).toBe("Store claim test");
  });
});
