import type { DatabaseSync } from "node:sqlite";
import { hashText, cosineSimilarity } from "./internal.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ClaimStatus = "verified" | "unverified" | "disputed" | "deprecated";
export type ClaimScope = "global" | "task";
export type ClaimType = "fact" | "decision" | "rule" | "preference" | "definition";

export type ClaimRecord = {
  id: string;
  text: string;
  claimType: ClaimType;
  scope: ClaimScope;
  taskId?: string;
  status: ClaimStatus;
  confidence: number;
  evidenceRefs: string[];
  sourcePath?: string;
  sourceLines?: string;
  embedding?: number[];
  createdAt: number;
  updatedAt: number;
};

// ---------------------------------------------------------------------------
// ID generation with canonicalization
// ---------------------------------------------------------------------------

/**
 * Normalize claim text for deduplication: whitespace collapse, trim, lowercase.
 */
export function normalizeClaimText(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Generate a deterministic claim ID from canonicalized text + scope + taskId.
 */
export function generateClaimId(text: string, scope: ClaimScope, taskId?: string): string {
  const canonical = normalizeClaimText(text) + scope + (taskId ?? "");
  return `claim_${hashText(canonical).slice(0, 16)}`;
}

// ---------------------------------------------------------------------------
// CRUD operations
// ---------------------------------------------------------------------------

export function upsertClaim(db: DatabaseSync, claim: ClaimRecord): void {
  const evidenceRefsJson = JSON.stringify(claim.evidenceRefs);
  const embeddingBlob =
    claim.embedding && claim.embedding.length > 0
      ? Buffer.from(new Float32Array(claim.embedding).buffer)
      : null;

  db.prepare(
    `INSERT INTO claims (id, text, scope, task_id, status, confidence, claim_type, evidence_refs, source_path, source_lines, embedding, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       text=excluded.text,
       status=excluded.status,
       confidence=excluded.confidence,
       claim_type=excluded.claim_type,
       evidence_refs=excluded.evidence_refs,
       source_path=excluded.source_path,
       source_lines=excluded.source_lines,
       embedding=excluded.embedding,
       updated_at=excluded.updated_at`,
  ).run(
    claim.id,
    claim.text,
    claim.scope,
    claim.taskId ?? null,
    claim.status,
    claim.confidence,
    claim.claimType,
    evidenceRefsJson,
    claim.sourcePath ?? null,
    claim.sourceLines ?? null,
    embeddingBlob,
    claim.createdAt,
    claim.updatedAt,
  );
}

export function getClaim(db: DatabaseSync, id: string): ClaimRecord | null {
  const row = db.prepare(`SELECT * FROM claims WHERE id = ?`).get(id) as ClaimRow | undefined;
  if (!row) {
    return null;
  }
  return rowToRecord(row);
}

export function listClaims(
  db: DatabaseSync,
  filter?: {
    scope?: ClaimScope;
    taskId?: string;
    status?: ClaimStatus;
    claimType?: ClaimType;
    limit?: number;
  },
): ClaimRecord[] {
  const conditions: string[] = [];
  const params: Array<string | number | null | Buffer> = [];

  if (filter?.scope) {
    conditions.push("scope = ?");
    params.push(filter.scope);
  }
  if (filter?.taskId) {
    conditions.push("task_id = ?");
    params.push(filter.taskId);
  }
  if (filter?.status) {
    conditions.push("status = ?");
    params.push(filter.status);
  }
  if (filter?.claimType) {
    conditions.push("claim_type = ?");
    params.push(filter.claimType);
  }

  const where = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
  const limit = filter?.limit ?? 500;

  const rows = db
    .prepare(`SELECT * FROM claims${where} ORDER BY updated_at DESC LIMIT ?`)
    .all(...params, limit) as ClaimRow[];
  return rows.map(rowToRecord);
}

export function updateClaimStatus(
  db: DatabaseSync,
  id: string,
  status: ClaimStatus,
  now?: number,
): boolean {
  const updatedAt = now ?? Date.now();
  const result = db
    .prepare(`UPDATE claims SET status = ?, updated_at = ? WHERE id = ?`)
    .run(status, updatedAt, id);
  return (result as { changes: number }).changes > 0;
}

export function deleteClaim(db: DatabaseSync, id: string): boolean {
  const result = db.prepare(`DELETE FROM claims WHERE id = ?`).run(id);
  return (result as { changes: number }).changes > 0;
}

// ---------------------------------------------------------------------------
// Vector search
// ---------------------------------------------------------------------------

/**
 * Search claims by cosine similarity against an embedding vector.
 * Uses in-memory cosine similarity over the BLOB embeddings stored in SQLite.
 */
export function searchClaimsByVector(
  db: DatabaseSync,
  queryVec: number[],
  opts?: {
    scope?: ClaimScope;
    taskId?: string;
    limit?: number;
    minScore?: number;
    statusFilter?: ClaimStatus[];
  },
): Array<ClaimRecord & { similarityScore: number }> {
  if (queryVec.length === 0) {
    return [];
  }

  const conditions: string[] = [];
  const params: Array<string | number | null | Buffer> = [];

  conditions.push("embedding IS NOT NULL");

  if (opts?.scope) {
    conditions.push("scope = ?");
    params.push(opts.scope);
  }
  if (opts?.taskId) {
    conditions.push("task_id = ?");
    params.push(opts.taskId);
  }
  if (opts?.statusFilter && opts.statusFilter.length > 0) {
    const placeholders = opts.statusFilter.map(() => "?").join(", ");
    conditions.push(`status IN (${placeholders})`);
    params.push(...opts.statusFilter);
  }

  const where = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
  const limit = opts?.limit ?? 50;
  const minScore = opts?.minScore ?? 0;

  const rows = db.prepare(`SELECT * FROM claims${where}`).all(...params) as ClaimRow[];

  const scored = rows
    .map((row) => {
      const embedding = parseBlobEmbedding(row.embedding);
      if (embedding.length === 0) {
        return null;
      }
      const score = cosineSimilarity(queryVec, embedding);
      if (!Number.isFinite(score) || score < minScore) {
        return null;
      }
      return { record: rowToRecord(row), similarityScore: score };
    })
    .filter((entry): entry is { record: ClaimRecord; similarityScore: number } => entry !== null);

  scored.sort((a, b) => b.similarityScore - a.similarityScore);

  return scored.slice(0, limit).map((entry) => ({
    ...entry.record,
    similarityScore: entry.similarityScore,
  }));
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type ClaimRow = {
  id: string;
  text: string;
  scope: string;
  task_id: string | null;
  status: string;
  confidence: number;
  claim_type: string | null;
  evidence_refs: string | null;
  source_path: string | null;
  source_lines: string | null;
  embedding: Buffer | null;
  created_at: number;
  updated_at: number;
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

function parseEvidenceRefs(raw: string | null): string[] {
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

function rowToRecord(row: ClaimRow): ClaimRecord {
  return {
    id: row.id,
    text: row.text,
    claimType: (row.claim_type as ClaimType) ?? "fact",
    scope: row.scope as ClaimScope,
    taskId: row.task_id ?? undefined,
    status: row.status as ClaimStatus,
    confidence: row.confidence,
    evidenceRefs: parseEvidenceRefs(row.evidence_refs),
    sourcePath: row.source_path ?? undefined,
    sourceLines: row.source_lines ?? undefined,
    embedding: parseBlobEmbedding(row.embedding),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
