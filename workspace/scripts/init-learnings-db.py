#!/usr/bin/env python3
"""
init-learnings-db.py
Creates SQLite learnings.db with Council-approved schema
Council A+ requirement #4
"""

import sqlite3
import sys
from pathlib import Path

WORKSPACE = Path(r"C:\dev\FsuelsBot\workspace")
DB_PATH = WORKSPACE / "memory" / "learnings.db"

SCHEMA = """
-- learnings.db schema
-- Council-approved MVP design (2026-01-29)
-- 6 kinds: fact, decision, preference, constraint, procedure, insight

CREATE TABLE IF NOT EXISTS learning (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    
    -- Core content
    statement TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('fact', 'decision', 'preference', 'constraint', 'procedure', 'insight')),
    
    -- Deduplication
    canonical_hash TEXT UNIQUE NOT NULL,
    
    -- Metadata
    tags TEXT DEFAULT '[]',
    source TEXT,
    entity TEXT,
    
    -- Confidence & lifecycle
    confidence REAL DEFAULT 0.8 CHECK (confidence >= 0 AND confidence <= 1),
    is_pinned INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    
    -- Epistemic status (Council improvement 2026-01-31)
    epistemic_status TEXT DEFAULT 'claimed' CHECK (epistemic_status IN ('claimed', 'evidence_provided', 'human_verified', 'automated_verified')),
    evidence_path TEXT,
    reasoning TEXT,
    
    -- Timestamps
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    expires_at TEXT,
    last_accessed_at TEXT,
    
    -- Audit
    created_by TEXT DEFAULT 'system',
    supersedes_id INTEGER REFERENCES learning(id)
);

CREATE INDEX IF NOT EXISTS idx_learning_kind ON learning(kind);
CREATE INDEX IF NOT EXISTS idx_learning_active ON learning(is_active);
CREATE INDEX IF NOT EXISTS idx_learning_pinned ON learning(is_pinned);
CREATE INDEX IF NOT EXISTS idx_learning_confidence ON learning(confidence);
CREATE INDEX IF NOT EXISTS idx_learning_hash ON learning(canonical_hash);
CREATE INDEX IF NOT EXISTS idx_learning_entity ON learning(entity);

CREATE VIEW IF NOT EXISTS active_learnings AS
SELECT * FROM learning 
WHERE is_active = 1 
  AND (expires_at IS NULL OR expires_at > datetime('now'))
ORDER BY is_pinned DESC, confidence DESC, updated_at DESC;

CREATE VIEW IF NOT EXISTS learnings_to_review AS
SELECT * FROM learning
WHERE is_active = 1
  AND is_pinned = 0
  AND (confidence < 0.5 OR updated_at < datetime('now', '-30 days'))
ORDER BY confidence ASC, updated_at ASC;
"""

def main():
    force = "--force" in sys.argv
    
    if DB_PATH.exists() and not force:
        print(f"learnings.db already exists at {DB_PATH}")
        print("Use --force to recreate")
        return
    
    if force and DB_PATH.exists():
        DB_PATH.unlink()
        print("Removed existing learnings.db")
    
    print("=== Creating learnings.db ===")
    
    conn = sqlite3.connect(DB_PATH)
    conn.executescript(SCHEMA)
    conn.commit()
    conn.close()
    
    print("[OK] learnings.db created successfully")
    print(f"Location: {DB_PATH}")
    print()
    print("Schema includes:")
    print("  - learning table (6 kinds)")
    print("  - canonical_hash for deduplication")
    print("  - is_pinned for P0 protection")
    print("  - confidence scoring")
    print("  - expires_at for auto-cleanup")
    print("  - active_learnings view")
    print("  - learnings_to_review view")

if __name__ == "__main__":
    main()
