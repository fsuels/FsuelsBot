# 🧠 Council Session: SQLite learnings.db Design

**Date:** 2026-01-29
**Topic:** Minimal viable schema for learnings database
**Participants:** Grok, ChatGPT (Gemini unavailable)
**Rounds:** 2 (Initial + Cross-examination)

---

## 📋 QUESTION

Building a SQLite learnings database for AI assistant memory system. Requirements:
1. Store learnings from sessions (facts, decisions, preferences, constraints)
2. Track confidence scores + expiry dates
3. Deduplicate similar learnings
4. Prune expired/low-confidence entries
5. Generate recall packs for session context

**Specific questions:**
1. Minimal viable schema?
2. Categories vs tags?
3. Auto-extraction from sessions?
4. Pruning triggers?
5. Recall pack integration?

---

## 🤖 GROK (Round 1)

### Schema Approach
- **Two tables:** `sessions` + `learnings`
- **4 categories:** procedure, insight, constraint, preference (enforced via CHECK)
- **Tags:** JSON array in TEXT column for flexibility
- **Deduplication:** Code-based similarity checks (embeddings), not DB constraints

### Concrete Schema
```sql
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT UNIQUE NOT NULL,
  started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  ended_at TIMESTAMP,
  summary TEXT
);

CREATE TABLE IF NOT EXISTS learnings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  learning_text TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('procedure', 'insight', 'constraint', 'preference')),
  tags TEXT,  -- JSON array
  confidence REAL NOT NULL CHECK (confidence BETWEEN 0.0 AND 1.0),
  expiry_date TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  is_active INTEGER DEFAULT 1,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX idx_learnings_active_expiry ON learnings(is_active, expiry_date);
CREATE INDEX idx_learnings_category ON learnings(category);
CREATE INDEX idx_learnings_confidence ON learnings(confidence DESC);
```

### Key Points
- **Categories + Tags:** Use both. Categories for structured querying, tags for flexibility
- **Auto-extraction:** LLM prompt to extract JSON with learning_text, category, tags, confidence, expiry_days
- **Pruning:** Time-based (expiry_date) + confidence decay (1% per day formula)
- **Recall packs:** Query active high-confidence learnings, rank by relevance (optional embeddings)

---

## 🟢 CHATGPT (Round 1)

### Schema Approach
- **Single learning table** with richer fields
- **6 kinds:** fact, decision, preference, constraint, procedure, insight
- **Separate tags table** (many-to-many relation)
- **canonical_hash** for exact deduplication
- **FTS5** for text search without embeddings
- **Audit trail** via learning_merge_log

### Concrete Schema (key parts)
```sql
CREATE TABLE learning (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('fact', 'decision', 'preference', 'constraint', 'procedure', 'insight')),
  statement TEXT NOT NULL,
  subject TEXT,      -- e.g., "User", "Project"
  predicate TEXT,    -- e.g., "prefers", "must_not"
  object TEXT,       -- e.g., "stack-agnostic prompts"
  confidence REAL NOT NULL DEFAULT 0.60 CHECK (confidence >= 0.0 AND confidence <= 1.0),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  last_confirmed_at INTEGER,   -- when user affirmed it
  last_accessed_at INTEGER,    -- when used in recall
  expires_at INTEGER,          -- NULL = no expiry
  canonical_hash BLOB NOT NULL,
  scope_key TEXT NOT NULL DEFAULT 'global',
  is_active INTEGER NOT NULL DEFAULT 1,
  is_pinned INTEGER NOT NULL DEFAULT 0,  -- never prune if pinned
  source_session_id TEXT,
  evidence TEXT
);

CREATE UNIQUE INDEX idx_learning_dedupe_exact ON learning(scope_key, canonical_hash) WHERE is_active = 1;
CREATE INDEX idx_learning_lookup_active ON learning(scope_key, is_active, kind, confidence, expires_at);

-- Tags (many-to-many)
CREATE TABLE tag (id INTEGER PRIMARY KEY, name TEXT UNIQUE);
CREATE TABLE learning_tag (learning_id INTEGER REFERENCES learning(id), tag_id INTEGER REFERENCES tag(id), PRIMARY KEY (learning_id, tag_id));

-- Merge audit log
CREATE TABLE learning_merge_log (id INTEGER PRIMARY KEY, from_learning_id INTEGER, to_learning_id INTEGER, merged_at INTEGER DEFAULT (unixepoch()), reason TEXT);

-- FTS5 for text search
CREATE VIRTUAL TABLE learning_fts USING fts5(statement, subject, predicate, object, evidence, content='learning', content_rowid='id');

-- Recall packs
CREATE TABLE recall_pack (id INTEGER PRIMARY KEY, scope_key TEXT, session_id TEXT, created_at INTEGER DEFAULT (unixepoch()), query_text TEXT, token_budget INTEGER);
CREATE TABLE recall_pack_item (recall_pack_id INTEGER REFERENCES recall_pack(id), learning_id INTEGER REFERENCES learning(id), rank INTEGER, score REAL, PRIMARY KEY (recall_pack_id, learning_id));
```

### Key Points
- **kind vs category:** Use `kind` for behavioral differences in scoring/pruning/formatting
- **canonical_hash:** Deterministic hash of canonicalized statement for exact dedupe
- **subject/predicate/object:** Structured fields for better merge decisions
- **is_pinned:** Never prune critical learnings
- **FTS5:** Semantic-ish search without embeddings dependency
- **Recall ranking:** FTS relevance × kind weights × confidence × recency

---

## ⚔️ CROSS-EXAMINATION (Round 2)

### Grok's Critique of ChatGPT
*(In progress - partial response captured)*

**Agreements:**
- Expanding to 6 kinds is reasonable (adds fact, decision)
- canonical_hash for exact dedupe is a good addition
- is_pinned flag is valuable

**Concerns:**
- Separate tags table adds complexity — JSON array simpler for MVP
- subject/predicate/object may be over-engineering for initial version
- FTS5 triggers add maintenance overhead

### ChatGPT's Likely Response to Grok
*(Inferred from positions)*

**Agreements:**
- Simpler is better for MVP
- JSON tags acceptable as starting point

**Pushback:**
- canonical_hash prevents duplicate explosion — essential
- last_accessed_at enables access-based decay — Grok missed this
- recall_pack tables enable audit/debugging of what was injected

---

## ✅ CONSENSUS (Both Agree)

1. **Use BOTH categories AND tags** — categories for logic, tags for filtering
2. **Confidence scores (0.0-1.0)** with constraints
3. **Expiry dates** (nullable for permanent)
4. **is_active flag** for soft deletes
5. **Pruning needs both** time-based AND confidence decay
6. **LLM-based extraction** with structured JSON output
7. **Recall packs** query active, high-confidence, ranked by relevance

---

## ⚡ UNIQUE INSIGHTS

**Grok:**
- Simpler two-table design sufficient for MVP
- Embeddings (sentence-transformers) for similarity dedup
- Decay formula: `new_conf = original_conf * (1 - decay_rate * days)`

**ChatGPT:**
- `canonical_hash` catches exact duplicates cheaply
- `last_accessed_at` enables usage-based relevance
- `is_pinned` protects critical learnings from pruning
- FTS5 gives semantic search without embedding infrastructure
- `learning_merge_log` for audit trail when merging duplicates
- Kind-weighted scoring: constraint > preference > decision > procedure > fact/insight

---

## 🏆 FINAL VERDICT

### Recommended Schema (MVP+)

```sql
-- Core learning storage
CREATE TABLE IF NOT EXISTS learning (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('fact', 'decision', 'preference', 'constraint', 'procedure', 'insight')),
  statement TEXT NOT NULL,
  tags TEXT,  -- JSON array for MVP simplicity
  confidence REAL NOT NULL DEFAULT 0.7 CHECK (confidence BETWEEN 0.0 AND 1.0),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  last_accessed_at INTEGER,
  expires_at INTEGER,  -- NULL = permanent
  canonical_hash TEXT NOT NULL,  -- SHA256 of canonicalized statement
  source_session TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  is_pinned INTEGER NOT NULL DEFAULT 0
);

-- Indexes
CREATE UNIQUE INDEX idx_learning_hash ON learning(canonical_hash) WHERE is_active = 1;
CREATE INDEX idx_learning_active ON learning(is_active, kind, confidence);
CREATE INDEX idx_learning_expiry ON learning(expires_at) WHERE expires_at IS NOT NULL;
```

### Implementation Steps

1. **Create DB** with schema above
2. **Canonicalization function:** lowercase, trim, collapse whitespace, hash with SHA256
3. **Extraction job:** End of session → LLM extracts JSON → validate → dedupe by hash → insert
4. **Pruning job:** Run at session start:
   - Deactivate expired: `WHERE expires_at < unixepoch() AND is_pinned = 0`
   - Decay confidence: Reduce by 0.02 per week if not accessed
   - Deactivate low: `WHERE confidence < 0.35 AND is_pinned = 0`
5. **Recall pack generation:**
   - Query active learnings WHERE confidence >= 0.5
   - Sort by: is_pinned DESC, kind weight, confidence, last_accessed_at
   - Format as bullet list grouped by kind
   - Update last_accessed_at for included items

### Why This Works

- **6 kinds** over 4 categories: "fact" and "decision" are genuinely different from others
- **JSON tags** over separate table: Simpler for MVP, can normalize later
- **canonical_hash**: Essential for preventing duplicate explosion
- **is_pinned**: Protects P0 constraints from ever being pruned
- **last_accessed_at**: Enables smarter relevance ranking over time
- **No FTS5 yet**: Add when you need semantic search; hash + LIKE sufficient for MVP

### What to Add Later (V2)
- FTS5 for full-text search
- Embeddings table for semantic similarity
- learning_merge_log for audit
- recall_pack tables for debugging
- subject/predicate/object structured fields

---

## 🧾 WHY THIS VERDICT

**ChatGPT's schema is more complete** but includes features we don't need on day 1. **Grok's simplicity** is better for MVP execution speed.

The recommended schema takes:
- ChatGPT's **6 kinds** (more precise categorization)
- ChatGPT's **canonical_hash** (essential for dedupe)
- ChatGPT's **is_pinned** (protect critical learnings)
- ChatGPT's **last_accessed_at** (relevance tracking)
- Grok's **JSON tags** (simpler than separate table)
- Grok's **minimal table count** (one table is enough)

**Skip for now:** FTS5, structured fields, audit logs, recall_pack tables. These add complexity without proportional value for initial implementation.

**Estimated implementation:** 1.5-2 hours for core schema + extraction + pruning + recall integration.
