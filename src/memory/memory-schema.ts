import type { DatabaseSync } from "node:sqlite";

export function ensureMemoryIndexSchema(params: {
  db: DatabaseSync;
  embeddingCacheTable: string;
  ftsTable: string;
  ftsEnabled: boolean;
}): { ftsAvailable: boolean; ftsError?: string } {
  params.db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  params.db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      path TEXT PRIMARY KEY,
      source TEXT NOT NULL DEFAULT 'memory',
      hash TEXT NOT NULL,
      mtime INTEGER NOT NULL,
      size INTEGER NOT NULL
    );
  `);
  params.db.exec(`
    CREATE TABLE IF NOT EXISTS chunks (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'memory',
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      hash TEXT NOT NULL,
      model TEXT NOT NULL,
      text TEXT NOT NULL,
      embedding TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  params.db.exec(`
    CREATE TABLE IF NOT EXISTS ${params.embeddingCacheTable} (
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      provider_key TEXT NOT NULL,
      hash TEXT NOT NULL,
      embedding TEXT NOT NULL,
      dims INTEGER,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (provider, model, provider_key, hash)
    );
  `);
  params.db.exec(
    `CREATE INDEX IF NOT EXISTS idx_embedding_cache_updated_at ON ${params.embeddingCacheTable}(updated_at);`,
  );

  let ftsAvailable = false;
  let ftsError: string | undefined;
  if (params.ftsEnabled) {
    try {
      params.db.exec(
        `CREATE VIRTUAL TABLE IF NOT EXISTS ${params.ftsTable} USING fts5(\n` +
          `  text,\n` +
          `  id UNINDEXED,\n` +
          `  path UNINDEXED,\n` +
          `  source UNINDEXED,\n` +
          `  model UNINDEXED,\n` +
          `  start_line UNINDEXED,\n` +
          `  end_line UNINDEXED\n` +
          `);`,
      );
      ftsAvailable = true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ftsAvailable = false;
      ftsError = message;
    }
  }

  ensureColumn(params.db, "files", "source", "TEXT NOT NULL DEFAULT 'memory'");
  ensureColumn(params.db, "chunks", "source", "TEXT NOT NULL DEFAULT 'memory'");
  params.db.exec(`CREATE INDEX IF NOT EXISTS idx_chunks_path ON chunks(path);`);
  params.db.exec(`CREATE INDEX IF NOT EXISTS idx_chunks_source ON chunks(source);`);

  // Claims table for structured knowledge assertions (Phase 1).
  params.db.exec(`
    CREATE TABLE IF NOT EXISTS claims (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'global',
      task_id TEXT,
      status TEXT NOT NULL DEFAULT 'unverified',
      confidence REAL DEFAULT 0.5,
      claim_type TEXT,
      evidence_refs TEXT,
      source_path TEXT,
      source_lines TEXT,
      embedding BLOB,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  params.db.exec(`CREATE INDEX IF NOT EXISTS idx_claims_scope ON claims(scope);`);
  params.db.exec(`CREATE INDEX IF NOT EXISTS idx_claims_status ON claims(status);`);
  params.db.exec(`CREATE INDEX IF NOT EXISTS idx_claims_task_id ON claims(task_id);`);

  // Q/A pairs table for self-healing answer capture (Phase 3).
  params.db.exec(`
    CREATE TABLE IF NOT EXISTS qa_pairs (
      id TEXT PRIMARY KEY,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      question_embedding BLOB,
      session_key TEXT,
      task_id TEXT,
      claim_refs TEXT,
      chunk_refs TEXT,
      model TEXT,
      feedback TEXT,
      correction TEXT,
      created_at INTEGER NOT NULL
    );
  `);
  params.db.exec(`CREATE INDEX IF NOT EXISTS idx_qa_pairs_session_key ON qa_pairs(session_key);`);
  params.db.exec(`CREATE INDEX IF NOT EXISTS idx_qa_pairs_task_id ON qa_pairs(task_id);`);

  return { ftsAvailable, ...(ftsError ? { ftsError } : {}) };
}

function ensureColumn(
  db: DatabaseSync,
  table: "files" | "chunks",
  column: string,
  definition: string,
): void {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (rows.some((row) => row.name === column)) {
    return;
  }
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
