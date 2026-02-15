import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { cosineSimilarity } from "./internal.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type QaPairRecord = {
  id: string;
  question: string;
  answer: string;
  questionEmbedding?: number[];
  sessionKey?: string;
  taskId?: string;
  claimRefs: string[];
  chunkRefs: string[];
  model?: string;
  feedback?: string;
  correction?: string;
  createdAt: number;
};

// ---------------------------------------------------------------------------
// CRUD operations
// ---------------------------------------------------------------------------

export function storeQaPair(db: DatabaseSync, pair: Omit<QaPairRecord, "id">): string {
  const id = `qa_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const embeddingBlob =
    pair.questionEmbedding && pair.questionEmbedding.length > 0
      ? Buffer.from(new Float32Array(pair.questionEmbedding).buffer)
      : null;

  db.prepare(
    `INSERT INTO qa_pairs (id, question, answer, question_embedding, session_key, task_id, claim_refs, chunk_refs, model, feedback, correction, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    pair.question,
    pair.answer,
    embeddingBlob,
    pair.sessionKey ?? null,
    pair.taskId ?? null,
    JSON.stringify(pair.claimRefs),
    JSON.stringify(pair.chunkRefs),
    pair.model ?? null,
    pair.feedback ?? null,
    pair.correction ?? null,
    pair.createdAt,
  );

  return id;
}

export function getQaPair(db: DatabaseSync, id: string): QaPairRecord | null {
  const row = db.prepare(`SELECT * FROM qa_pairs WHERE id = ?`).get(id) as QaPairRow | undefined;
  if (!row) {
    return null;
  }
  return rowToRecord(row);
}

export function listQaPairs(
  db: DatabaseSync,
  filter?: {
    sessionKey?: string;
    taskId?: string;
    limit?: number;
  },
): QaPairRecord[] {
  const conditions: string[] = [];
  const params: Array<string | number | null | Buffer> = [];

  if (filter?.sessionKey) {
    conditions.push("session_key = ?");
    params.push(filter.sessionKey);
  }
  if (filter?.taskId) {
    conditions.push("task_id = ?");
    params.push(filter.taskId);
  }

  const where = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
  const limit = filter?.limit ?? 200;

  const rows = db
    .prepare(`SELECT * FROM qa_pairs${where} ORDER BY created_at DESC LIMIT ?`)
    .all(...params, limit) as QaPairRow[];
  return rows.map(rowToRecord);
}

export function updateQaFeedback(
  db: DatabaseSync,
  id: string,
  feedback: string,
  correction?: string,
): boolean {
  const result = db
    .prepare(`UPDATE qa_pairs SET feedback = ?, correction = ? WHERE id = ?`)
    .run(feedback, correction ?? null, id);
  return (result as { changes: number }).changes > 0;
}

// ---------------------------------------------------------------------------
// Vector search for similar past Q/A pairs
// ---------------------------------------------------------------------------

export function searchQaByVector(
  db: DatabaseSync,
  queryVec: number[],
  opts?: { limit?: number; minScore?: number; sessionKey?: string; taskId?: string },
): Array<QaPairRecord & { similarityScore: number }> {
  if (queryVec.length === 0) {
    return [];
  }

  const conditions: string[] = ["question_embedding IS NOT NULL"];
  const params: Array<string | number | null | Buffer> = [];

  if (opts?.sessionKey) {
    conditions.push("session_key = ?");
    params.push(opts.sessionKey);
  }
  if (opts?.taskId) {
    conditions.push("task_id = ?");
    params.push(opts.taskId);
  }

  const where = ` WHERE ${conditions.join(" AND ")}`;
  const limit = opts?.limit ?? 10;
  const minScore = opts?.minScore ?? 0;

  const rows = db.prepare(`SELECT * FROM qa_pairs${where}`).all(...params) as QaPairRow[];

  const scored = rows
    .map((row) => {
      const embedding = parseBlobEmbedding(row.question_embedding);
      if (embedding.length === 0) {
        return null;
      }
      const score = cosineSimilarity(queryVec, embedding);
      if (!Number.isFinite(score) || score < minScore) {
        return null;
      }
      return { record: rowToRecord(row), similarityScore: score };
    })
    .filter((entry): entry is { record: QaPairRecord; similarityScore: number } => entry !== null);

  scored.sort((a, b) => b.similarityScore - a.similarityScore);

  return scored.slice(0, limit).map((entry) => ({
    ...entry.record,
    similarityScore: entry.similarityScore,
  }));
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type QaPairRow = {
  id: string;
  question: string;
  answer: string;
  question_embedding: Buffer | null;
  session_key: string | null;
  task_id: string | null;
  claim_refs: string | null;
  chunk_refs: string | null;
  model: string | null;
  feedback: string | null;
  correction: string | null;
  created_at: number;
};

function parseBlobEmbedding(blob: Buffer | null): number[] {
  if (!blob || blob.length === 0) {
    return [];
  }
  try {
    const float32 = new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4);
    return Array.from(float32);
  } catch {
    return [];
  }
}

function parseJsonArray(raw: string | null): string[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function rowToRecord(row: QaPairRow): QaPairRecord {
  return {
    id: row.id,
    question: row.question,
    answer: row.answer,
    questionEmbedding: parseBlobEmbedding(row.question_embedding),
    sessionKey: row.session_key ?? undefined,
    taskId: row.task_id ?? undefined,
    claimRefs: parseJsonArray(row.claim_refs),
    chunkRefs: parseJsonArray(row.chunk_refs),
    model: row.model ?? undefined,
    feedback: row.feedback ?? undefined,
    correction: row.correction ?? undefined,
    createdAt: row.created_at,
  };
}
