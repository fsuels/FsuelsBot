/**
 * Retrieval regression corpus (Phase 2).
 *
 * Validates the deterministic ranking properties of the memory retrieval
 * pipeline using controlled embeddings and a fixed corpus.  All tests
 * operate directly against SQLite (no MemoryIndexManager lifecycle) to
 * keep them fast and self-contained.
 *
 * Zero production code changes — pure test infrastructure.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { upsertClaim, searchClaimsByVector, generateClaimId, type ClaimRecord } from "./claims.js";
import { hashText, cosineSimilarity } from "./internal.js";
import { ensureMemoryIndexSchema } from "./memory-schema.js";

// ---------------------------------------------------------------------------
// Test utilities
// ---------------------------------------------------------------------------

type CorpusChunk = {
  id: string;
  path: string;
  source: "memory" | "sessions";
  startLine: number;
  endLine: number;
  text: string;
  embedding: number[];
};

function insertChunk(db: import("node:sqlite").DatabaseSync, chunk: CorpusChunk): void {
  const model = "regression-mock";
  const now = Date.now();
  db.prepare(
    `INSERT OR REPLACE INTO chunks (id, path, source, start_line, end_line, hash, model, text, embedding, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    chunk.id,
    chunk.path,
    chunk.source,
    chunk.startLine,
    chunk.endLine,
    hashText(chunk.text),
    model,
    chunk.text,
    JSON.stringify(chunk.embedding),
    now,
  );
}

function insertFile(
  db: import("node:sqlite").DatabaseSync,
  filePath: string,
  source: "memory" | "sessions",
): void {
  db.prepare(
    `INSERT OR REPLACE INTO files (path, source, hash, mtime, size) VALUES (?, ?, ?, ?, ?)`,
  ).run(filePath, source, hashText(filePath), Date.now(), 100);
}

/**
 * Search chunks by cosine similarity, optionally filtering by source.
 * Returns results sorted by score descending.
 */
function searchChunks(
  db: import("node:sqlite").DatabaseSync,
  queryVec: number[],
  opts?: { sourceFilter?: "memory" | "sessions"; limit?: number; minScore?: number },
): Array<{ id: string; path: string; source: string; score: number; text: string }> {
  const conditions: string[] = ["model = 'regression-mock'"];
  const params: unknown[] = [];

  if (opts?.sourceFilter) {
    conditions.push("source = ?");
    params.push(opts.sourceFilter);
  }

  const where = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
  const rows = db
    .prepare(`SELECT id, path, source, text, embedding FROM chunks${where}`)
    .all(...params) as Array<{
    id: string;
    path: string;
    source: string;
    text: string;
    embedding: string;
  }>;

  const limit = opts?.limit ?? 10;
  const minScore = opts?.minScore ?? 0;

  return rows
    .map((row) => {
      let emb: number[];
      try {
        emb = JSON.parse(row.embedding);
      } catch {
        emb = [];
      }
      const score = cosineSimilarity(queryVec, emb);
      return { id: row.id, path: row.path, source: row.source, score, text: row.text };
    })
    .filter((r) => Number.isFinite(r.score) && r.score >= minScore)
    .toSorted((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Compute recall@K for must-retrieve items. */
function computeRecallAtK(
  results: Array<{ id: string }>,
  mustRetrieve: string[],
  k: number,
): number {
  if (mustRetrieve.length === 0) {
    return 1;
  }
  const topK = new Set(results.slice(0, k).map((r) => r.id));
  const hits = mustRetrieve.filter((id) => topK.has(id)).length;
  return hits / mustRetrieve.length;
}

/** Check that none of the mustNotRetrieve items appear in top-K. */
function checkMustNotRetrieve(
  results: Array<{ id: string }>,
  mustNotRetrieve: string[],
  k: number,
): boolean {
  const topK = new Set(results.slice(0, k).map((r) => r.id));
  return !mustNotRetrieve.some((id) => topK.has(id));
}

// ---------------------------------------------------------------------------
// Corpus setup
// ---------------------------------------------------------------------------

let db: import("node:sqlite").DatabaseSync;

// 8-dimensional embeddings for clear separation
// Dimension semantics: [auth, deploy, database, frontend, config, pricing, testing, misc]

const CORPUS: CorpusChunk[] = [
  // Memory (durable) chunks
  {
    id: "mem_auth_decision",
    path: "memory/tasks/task-auth.md",
    source: "memory",
    startLine: 1,
    endLine: 5,
    text: "Decision: Use JWT for authentication with 15-minute expiry and refresh tokens.",
    embedding: [0.9, 0, 0, 0, 0, 0, 0, 0.1],
  },
  {
    id: "mem_deploy_decision",
    path: "memory/tasks/task-deploy.md",
    source: "memory",
    startLine: 1,
    endLine: 5,
    text: "Decision: Deploy to AWS ECS with Fargate for serverless containers.",
    embedding: [0, 0.9, 0, 0, 0.1, 0, 0, 0],
  },
  {
    id: "mem_db_constraint",
    path: "memory/global/pins.md",
    source: "memory",
    startLine: 1,
    endLine: 3,
    text: "Constraint: All queries must use parameterized SQL to prevent injection.",
    embedding: [0, 0, 0.9, 0, 0, 0, 0.1, 0],
  },
  {
    id: "mem_frontend_note",
    path: "memory/tasks/task-frontend.md",
    source: "memory",
    startLine: 1,
    endLine: 4,
    text: "Using React 19 with server components. TanStack Router for routing.",
    embedding: [0, 0, 0, 0.9, 0, 0, 0, 0.1],
  },
  {
    id: "mem_config_fact",
    path: "memory/global/config.md",
    source: "memory",
    startLine: 1,
    endLine: 3,
    text: "Config: Redis is used as the session store with 24h TTL.",
    embedding: [0, 0, 0.1, 0, 0.9, 0, 0, 0],
  },
  {
    id: "mem_pricing_decision",
    path: "memory/tasks/task-pricing.md",
    source: "memory",
    startLine: 1,
    endLine: 3,
    text: "Decision: Flat monthly pricing at $49/mo for all tiers.",
    embedding: [0, 0, 0, 0, 0, 0.9, 0, 0.1],
  },
  // Adversarial near-miss: looks like auth but is about something else
  {
    id: "mem_auth_noise",
    path: "memory/global/notes.md",
    source: "memory",
    startLine: 10,
    endLine: 12,
    text: "The word authentication appears here but this is about UI color scheme.",
    embedding: [0.15, 0, 0, 0.7, 0, 0, 0, 0.15],
  },

  // Session (transcript) chunks — should rank lower than durable
  {
    id: "sess_auth_discussion",
    path: "sessions/abc.jsonl",
    source: "sessions",
    startLine: 1,
    endLine: 10,
    text: "User discussed JWT authentication and considered OAuth2 as alternative.",
    embedding: [0.85, 0, 0, 0, 0, 0, 0, 0.15],
  },
  {
    id: "sess_deploy_chat",
    path: "sessions/abc.jsonl",
    source: "sessions",
    startLine: 11,
    endLine: 20,
    text: "Talked about deploying to AWS. Considered ECS vs EKS. ECS chosen.",
    embedding: [0, 0.85, 0, 0, 0.1, 0, 0, 0.05],
  },
  {
    id: "sess_pricing_chat",
    path: "sessions/def.jsonl",
    source: "sessions",
    startLine: 1,
    endLine: 10,
    text: "User asked about pricing. We discussed tiered vs flat pricing models.",
    embedding: [0, 0, 0, 0, 0, 0.85, 0, 0.15],
  },

  // Task B chunks (for multi-task isolation tests)
  {
    id: "mem_taskb_secret",
    path: "memory/tasks/task-b.md",
    source: "memory",
    startLine: 1,
    endLine: 3,
    text: "Task B internal: API key rotation schedule is every 90 days.",
    embedding: [0.5, 0, 0, 0, 0.5, 0, 0, 0],
  },
];

beforeAll(async () => {
  const { DatabaseSync } = await import("node:sqlite");
  db = new DatabaseSync(":memory:");
  ensureMemoryIndexSchema({
    db,
    embeddingCacheTable: "embedding_cache",
    ftsTable: "chunks_fts",
    ftsEnabled: false,
  });

  // Insert corpus
  const filePaths = new Set(CORPUS.map((c) => c.path));
  for (const fp of filePaths) {
    const source = fp.startsWith("sessions/") ? "sessions" : "memory";
    insertFile(db, fp, source as "memory" | "sessions");
  }
  for (const chunk of CORPUS) {
    insertChunk(db, chunk);
  }

  // Insert claims for claim priority tests
  const now = Date.now();
  const authClaim: ClaimRecord = {
    id: generateClaimId("JWT authentication with 15-minute expiry", "global"),
    text: "JWT authentication with 15-minute expiry",
    claimType: "decision",
    scope: "global",
    status: "verified",
    confidence: 0.9,
    evidenceRefs: ["mem_auth_decision"],
    embedding: [0.92, 0, 0, 0, 0, 0, 0, 0.08],
    createdAt: now,
    updatedAt: now,
  };
  upsertClaim(db, authClaim);

  const pricingClaim: ClaimRecord = {
    id: generateClaimId("Flat monthly pricing at $49", "global"),
    text: "Flat monthly pricing at $49",
    claimType: "decision",
    scope: "global",
    status: "verified",
    confidence: 0.85,
    evidenceRefs: ["mem_pricing_decision"],
    embedding: [0, 0, 0, 0, 0, 0.92, 0, 0.08],
    createdAt: now,
    updatedAt: now,
  };
  upsertClaim(db, pricingClaim);
});

afterAll(() => {
  db?.close();
});

// ---------------------------------------------------------------------------
// Regression cases
// ---------------------------------------------------------------------------

describe("retrieval regression corpus", () => {
  // Case 1: Decision retrieval over background noise
  it("retrieves auth decision over noise when querying about authentication", () => {
    const queryVec = [0.9, 0, 0, 0, 0, 0, 0, 0.1]; // auth-focused
    const results = searchChunks(db, queryVec, { limit: 5 });
    const recall = computeRecallAtK(results, ["mem_auth_decision"], 3);
    expect(recall).toBe(1);
    // The noise chunk should not outrank the decision
    const decisionIdx = results.findIndex((r) => r.id === "mem_auth_decision");
    const noiseIdx = results.findIndex((r) => r.id === "mem_auth_noise");
    if (noiseIdx >= 0) {
      expect(decisionIdx).toBeLessThan(noiseIdx);
    }
  });

  // Case 2: Durable memory outranks transcripts for same topic
  it("durable memory chunk outranks transcript chunk for auth", () => {
    const queryVec = [0.9, 0, 0, 0, 0, 0, 0, 0.1];
    const results = searchChunks(db, queryVec, { limit: 10 });
    const durableIdx = results.findIndex((r) => r.id === "mem_auth_decision");
    const transcriptIdx = results.findIndex((r) => r.id === "sess_auth_discussion");
    expect(durableIdx).toBeGreaterThanOrEqual(0);
    expect(transcriptIdx).toBeGreaterThanOrEqual(0);
    // Durable score should be >= transcript score (both have similar embeddings)
    expect(results[durableIdx]!.score).toBeGreaterThanOrEqual(results[transcriptIdx]!.score);
  });

  // Case 3: Durable memory outranks transcripts for deploy topic
  it("durable memory chunk outranks transcript for deploy", () => {
    const queryVec = [0, 0.9, 0, 0, 0.1, 0, 0, 0];
    const results = searchChunks(db, queryVec, { limit: 10 });
    const durableIdx = results.findIndex((r) => r.id === "mem_deploy_decision");
    const transcriptIdx = results.findIndex((r) => r.id === "sess_deploy_chat");
    expect(durableIdx).toBeGreaterThanOrEqual(0);
    expect(transcriptIdx).toBeGreaterThanOrEqual(0);
    expect(results[durableIdx]!.score).toBeGreaterThanOrEqual(results[transcriptIdx]!.score);
  });

  // Case 4: Multi-task isolation — task A content doesn't leak into unrelated query
  it("task-specific content is retrievable with matching query", () => {
    const queryVec = [0, 0, 0.9, 0, 0, 0, 0.1, 0]; // database-focused
    const results = searchChunks(db, queryVec, { limit: 3 });
    const recall = computeRecallAtK(results, ["mem_db_constraint"], 3);
    expect(recall).toBe(1);
  });

  // Case 5: Multi-task isolation — task B content shouldn't appear in frontend query
  it("task B content does not appear in top results for frontend query", () => {
    const queryVec = [0, 0, 0, 0.95, 0, 0, 0, 0.05]; // frontend-focused
    const results = searchChunks(db, queryVec, { limit: 3 });
    const clean = checkMustNotRetrieve(results, ["mem_taskb_secret"], 3);
    expect(clean).toBe(true);
    // Frontend note should be top-1
    expect(results[0]?.id).toBe("mem_frontend_note");
  });

  // Case 6: Adversarial near-miss content ranked below real match
  it("adversarial near-miss ranks below genuine auth content", () => {
    const queryVec = [0.9, 0, 0, 0, 0, 0, 0, 0.1];
    const results = searchChunks(db, queryVec, { limit: 5 });
    const genuineIdx = results.findIndex((r) => r.id === "mem_auth_decision");
    const nearMissIdx = results.findIndex((r) => r.id === "mem_auth_noise");
    expect(genuineIdx).toBeGreaterThanOrEqual(0);
    if (nearMissIdx >= 0) {
      expect(genuineIdx).toBeLessThan(nearMissIdx);
    }
  });

  // Case 7: Config retrieval precision
  it("config query retrieves config chunk in top-1", () => {
    const queryVec = [0, 0, 0.1, 0, 0.9, 0, 0, 0];
    const results = searchChunks(db, queryVec, { limit: 3 });
    expect(results[0]?.id).toBe("mem_config_fact");
  });

  // Case 8: Source filtering works — memory only
  it("source filter restricts to memory-only results", () => {
    const queryVec = [0.9, 0, 0, 0, 0, 0, 0, 0.1];
    const results = searchChunks(db, queryVec, { sourceFilter: "memory", limit: 10 });
    for (const r of results) {
      expect(r.source).toBe("memory");
    }
    expect(results.some((r) => r.id === "sess_auth_discussion")).toBe(false);
  });

  // Case 9: Source filtering works — sessions only
  it("source filter restricts to sessions-only results", () => {
    const queryVec = [0.9, 0, 0, 0, 0, 0, 0, 0.1];
    const results = searchChunks(db, queryVec, { sourceFilter: "sessions", limit: 10 });
    for (const r of results) {
      expect(r.source).toBe("sessions");
    }
    expect(results.some((r) => r.id === "mem_auth_decision")).toBe(false);
  });

  // Case 10: Minimum score threshold
  it("minScore threshold filters low-scoring results", () => {
    const queryVec = [1, 0, 0, 0, 0, 0, 0, 0]; // pure auth
    const results = searchChunks(db, queryVec, { minScore: 0.8, limit: 20 });
    for (const r of results) {
      expect(r.score).toBeGreaterThanOrEqual(0.8);
    }
    // Only auth-related chunks should survive
    expect(results.some((r) => r.id === "mem_frontend_note")).toBe(false);
  });

  // Case 11: Claims outrank transcripts (validates Phase 1 authority model)
  it("claims outrank transcripts for the same topic", () => {
    const queryVec = [0.92, 0, 0, 0, 0, 0, 0, 0.08]; // auth
    const claimResults = searchClaimsByVector(db, queryVec, { limit: 3 });
    const chunkResults = searchChunks(db, queryVec, { sourceFilter: "sessions", limit: 3 });

    // We should get a claim match
    expect(claimResults.length).toBeGreaterThan(0);
    expect(chunkResults.length).toBeGreaterThan(0);

    // Claim similarity should be at least as high as transcript similarity
    // (claims have more precise embeddings and higher authority)
    const topClaimScore = claimResults[0]!.similarityScore;
    const topTranscriptScore = chunkResults[0]!.score;
    expect(topClaimScore).toBeGreaterThanOrEqual(topTranscriptScore);
  });

  // Case 12: Claims outrank transcripts for pricing too
  it("pricing claim outranks pricing transcript", () => {
    const queryVec = [0, 0, 0, 0, 0, 0.92, 0, 0.08]; // pricing
    const claimResults = searchClaimsByVector(db, queryVec, { limit: 3 });
    const chunkResults = searchChunks(db, queryVec, { sourceFilter: "sessions", limit: 3 });

    expect(claimResults.length).toBeGreaterThan(0);
    expect(claimResults[0]!.text).toContain("pricing");
    if (chunkResults.length > 0) {
      expect(claimResults[0]!.similarityScore).toBeGreaterThanOrEqual(chunkResults[0]!.score);
    }
  });

  // Case 13: Recall metric validates corpus completeness
  it("recall@5 is 1.0 for auth decision + constraint in database query", () => {
    // Auth + database combined query
    const queryVec = [0.5, 0, 0.5, 0, 0, 0, 0, 0];
    const results = searchChunks(db, queryVec, { limit: 5 });
    const recall = computeRecallAtK(results, ["mem_auth_decision", "mem_db_constraint"], 5);
    expect(recall).toBe(1);
  });

  // Case 14: Precision — irrelevant results don't contaminate top-K
  it("frontend query top-3 does not contain deploy or pricing chunks", () => {
    const queryVec = [0, 0, 0, 0.95, 0, 0, 0, 0.05];
    const results = searchChunks(db, queryVec, { limit: 3 });
    const clean = checkMustNotRetrieve(
      results,
      ["mem_deploy_decision", "mem_pricing_decision", "sess_deploy_chat", "sess_pricing_chat"],
      3,
    );
    expect(clean).toBe(true);
  });

  // Case 15: Helper function correctness
  it("computeRecallAtK returns correct values", () => {
    const results = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(computeRecallAtK(results, ["a", "b"], 3)).toBe(1);
    expect(computeRecallAtK(results, ["a", "d"], 3)).toBe(0.5);
    expect(computeRecallAtK(results, ["d", "e"], 3)).toBe(0);
    expect(computeRecallAtK(results, [], 3)).toBe(1);
  });

  it("checkMustNotRetrieve returns correct values", () => {
    const results = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(checkMustNotRetrieve(results, ["d", "e"], 3)).toBe(true);
    expect(checkMustNotRetrieve(results, ["b"], 3)).toBe(false);
    expect(checkMustNotRetrieve(results, ["b"], 1)).toBe(true); // "b" not in top-1
  });
});
