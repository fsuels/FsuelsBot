import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureMemoryIndexSchema } from "./memory-schema.js";
import {
  storeQaPair,
  getQaPair,
  listQaPairs,
  updateQaFeedback,
  searchQaByVector,
} from "./qa-store.js";

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

describe("Q/A store CRUD", () => {
  const now = Date.now();

  it("stores and retrieves a Q/A pair", () => {
    const id = storeQaPair(db, {
      question: "What auth method do we use?",
      answer: "JWT with 15-minute expiry.",
      sessionKey: "sess_001",
      taskId: "task-auth",
      claimRefs: ["claim_abc"],
      chunkRefs: ["chunk_123"],
      model: "gpt-4o",
      createdAt: now,
    });

    expect(id).toMatch(/^qa_[a-f0-9]{16}$/);

    const retrieved = getQaPair(db, id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.question).toBe("What auth method do we use?");
    expect(retrieved!.answer).toBe("JWT with 15-minute expiry.");
    expect(retrieved!.sessionKey).toBe("sess_001");
    expect(retrieved!.taskId).toBe("task-auth");
    expect(retrieved!.claimRefs).toEqual(["claim_abc"]);
    expect(retrieved!.chunkRefs).toEqual(["chunk_123"]);
    expect(retrieved!.model).toBe("gpt-4o");
    expect(retrieved!.feedback).toBeUndefined();
    expect(retrieved!.correction).toBeUndefined();
  });

  it("stores Q/A pair with no optional fields", () => {
    const id = storeQaPair(db, {
      question: "minimal question",
      answer: "minimal answer",
      claimRefs: [],
      chunkRefs: [],
      createdAt: now,
    });

    const retrieved = getQaPair(db, id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.sessionKey).toBeUndefined();
    expect(retrieved!.taskId).toBeUndefined();
    expect(retrieved!.model).toBeUndefined();
  });

  it("returns null for non-existent ID", () => {
    expect(getQaPair(db, "nonexistent")).toBeNull();
  });

  it("lists Q/A pairs by session key", () => {
    storeQaPair(db, {
      question: "Q in session A",
      answer: "A in session A",
      sessionKey: "sess_list_a",
      claimRefs: [],
      chunkRefs: [],
      createdAt: now,
    });
    storeQaPair(db, {
      question: "Q in session B",
      answer: "A in session B",
      sessionKey: "sess_list_b",
      claimRefs: [],
      chunkRefs: [],
      createdAt: now + 1,
    });

    const sessionA = listQaPairs(db, { sessionKey: "sess_list_a" });
    expect(sessionA.length).toBeGreaterThanOrEqual(1);
    expect(sessionA.every((qa) => qa.sessionKey === "sess_list_a")).toBe(true);

    const sessionB = listQaPairs(db, { sessionKey: "sess_list_b" });
    expect(sessionB.length).toBeGreaterThanOrEqual(1);
    expect(sessionB.every((qa) => qa.sessionKey === "sess_list_b")).toBe(true);
  });

  it("lists Q/A pairs by task ID", () => {
    storeQaPair(db, {
      question: "Q for task X",
      answer: "A for task X",
      taskId: "task-x-list",
      claimRefs: [],
      chunkRefs: [],
      createdAt: now,
    });

    const results = listQaPairs(db, { taskId: "task-x-list" });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.every((qa) => qa.taskId === "task-x-list")).toBe(true);
  });

  it("updates feedback and correction", () => {
    const id = storeQaPair(db, {
      question: "Feedback test Q",
      answer: "Feedback test A",
      claimRefs: [],
      chunkRefs: [],
      createdAt: now,
    });

    const updated = updateQaFeedback(db, id, "positive", "Minor correction");
    expect(updated).toBe(true);

    const retrieved = getQaPair(db, id);
    expect(retrieved!.feedback).toBe("positive");
    expect(retrieved!.correction).toBe("Minor correction");
  });

  it("returns false for feedback update on non-existent ID", () => {
    expect(updateQaFeedback(db, "nonexistent", "positive")).toBe(false);
  });

  it("stores claim_refs and chunk_refs as stable IDs", () => {
    const id = storeQaPair(db, {
      question: "Refs test",
      answer: "Refs answer",
      claimRefs: ["claim_a1b2c3d4e5f6g7h8", "claim_9876543210abcdef"],
      chunkRefs: ["chunk_deadbeef12345678", "chunk_cafebabe87654321"],
      createdAt: now,
    });

    const retrieved = getQaPair(db, id);
    expect(retrieved!.claimRefs).toEqual(["claim_a1b2c3d4e5f6g7h8", "claim_9876543210abcdef"]);
    expect(retrieved!.chunkRefs).toEqual(["chunk_deadbeef12345678", "chunk_cafebabe87654321"]);
  });
});

describe("Q/A vector search", () => {
  it("finds similar past Q/A pairs by embedding", () => {
    const now = Date.now();
    storeQaPair(db, {
      question: "How do we handle auth?",
      answer: "JWT tokens with refresh.",
      questionEmbedding: [0.9, 0.1, 0, 0],
      claimRefs: [],
      chunkRefs: [],
      createdAt: now,
    });
    storeQaPair(db, {
      question: "What is the deploy process?",
      answer: "ECS Fargate via CI/CD.",
      questionEmbedding: [0, 0.1, 0.9, 0],
      claimRefs: [],
      chunkRefs: [],
      createdAt: now,
    });

    const results = searchQaByVector(db, [0.85, 0.15, 0, 0]);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]!.question).toContain("auth");
    expect(results[0]!.similarityScore).toBeGreaterThan(0.8);
  });

  it("returns empty for zero-length query vector", () => {
    expect(searchQaByVector(db, [])).toEqual([]);
  });

  it("respects task ID filter in vector search", () => {
    const now = Date.now();
    storeQaPair(db, {
      question: "Task-scoped Q",
      answer: "Task-scoped A",
      questionEmbedding: [0, 0, 0, 1],
      taskId: "task-vec-filter",
      claimRefs: [],
      chunkRefs: [],
      createdAt: now,
    });

    const withTask = searchQaByVector(db, [0, 0, 0, 0.9], { taskId: "task-vec-filter" });
    expect(withTask.some((r) => r.taskId === "task-vec-filter")).toBe(true);

    const withoutTask = searchQaByVector(db, [0, 0, 0, 0.9], { taskId: "no-such-task" });
    expect(withoutTask.some((r) => r.taskId === "task-vec-filter")).toBe(false);
  });
});
