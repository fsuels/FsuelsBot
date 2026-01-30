# Council Debate: Supermemory vs Our Memory System
**Date:** 2026-01-29
**Participants:** Grok 4.1, ChatGPT 5.2, Gemini (unavailable - CLI timeout)
**Rounds Completed:** 1 (Initial Positions)

## Executive Summary

Both Grok and ChatGPT strongly recommend adopting ALL FIVE Supermemory concepts, with similar priority orderings. Key consensus:

1. **Static/Dynamic Profiles** — Immediate win, fits existing file structure
2. **Automatic Forgetting/Decay** — Essential for scalability, prevents "context drag"
3. **Local Semantic Search** — Achievable with open-source tools (sentence-transformers, FAISS)
4. **Graph Memory Relationships** — Adds value once retrieval exists
5. **Automatic Fact Extraction** — Adopt cautiously with schema constraints

**Critical Insight:** Both AIs emphasized treating Supermemory's innovations as *data structures + policies + indexing*, NOT as a product requiring paid APIs.

---

## Round 1: Initial Positions

### 🔵 GROK 4.1 (Thought for 42s)

**Overall Position:** Adopt ALL FIVE concepts — all implementable locally with free open-source tools.

**Priority Order:**
1. Static + Dynamic profiles (Adopt immediately)
2. Automatic fact extraction (Adopt with priority)
3. Graph Memory (Strongly adopt)
4. Automatic forgetting/decay (Adopt for scalability)
5. Semantic search (Adopt if compute allows)

**Detailed Reasoning:**

#### 1. Graph Memory: UPDATES/EXTENDS/DERIVES
**Position: Strongly adopt**

> This would significantly enhance your manual knowledge curation by allowing structured relationships, making your knowledge/wiki more dynamic and interconnected. It addresses limitations in your flat file structure.

**Implementation Ideas:**
- Store in `knowledge/graph.json` with nodes (facts) and edges (relationships)
- Use Python's networkx library (free, local) to build/query
- Script function to check conflicts and add edges when processing events.jsonl

#### 2. Automatic Fact Extraction
**Position: Adopt with priority**

> This directly improves on your manual curation, automating knowledge population from events.jsonl or new interactions.

**Implementation Ideas:**
- Use spaCy (download once, run locally) to parse text
- Extract nouns, relations, sentences as "facts"
- Start with regex patterns for common structures before adding NLP
- Run periodically or on new appends

#### 3. Static + Dynamic Profiles
**Position: Adopt immediately (low-effort win)**

> This is a low-effort win that organizes your state.json better, separating unchanging info from transient data.

**Implementation Ideas:**
- Split into `static_profile.json` and `dynamic_profile.jsonl`
- Static: name, core_goals, preferences
- Dynamic: recent context, timestamps, active threads
- Load both for queries; prioritize dynamic for short-term

#### 4. Automatic Forgetting/Decay
**Position: Adopt for scalability**

> This prevents your files from growing indefinitely, focusing decay on episodic data while keeping core facts.

**Implementation Ideas:**
- Add timestamps to all entries
- Python cron-like script to scan files
- Delete/archive lines older than X days
- Facts persist unless explicitly updated via graph relations

#### 5. Semantic Search (<300ms)
**Position: Adopt if compute allows**

> This upgrades your keyword-only search to something more intelligent, enabling faster, relevance-based recall.

**Implementation Ideas:**
- Use sentence-transformers (free Hugging Face model)
- Store embeddings in JSON array or NumPy file
- Use FAISS (free library) for fast ANN indexing
- <300ms realistic on typical dev machine for 10k-100k memories

**Grok's Suggested Order:** Start with profiles + decay for quick wins, then add fact extraction + graph for automation, finally semantic search for performance.

---

### 🟢 CHATGPT 5.2

**Overall Position:** Adopt ALL FIVE but in specific priority order based on implementation complexity.

**Priority Order:**
1. Static + Dynamic profile (#3)
2. Automatic forgetting/decay (#4)
3. Fast recall via LOCAL semantic search (#5)
4. Graph memory relationships (#1)
5. Automatic fact extraction (#2) — bounded, schema-driven

**Key Insight:**
> (3) and (4) are *policies* on top of existing file layers; (5) is achievable locally with open-source embeddings; (1) becomes valuable once retrieval exists; (2) is hardest without an LLM, so constrain it.

**Detailed Implementation Guidance:**

#### 1. Static + Dynamic Profiles
**Position: High ROI, low risk**

> You already have layered storage; this adds a "hot path" for personalization.

**File Design:**
- `state.json` (static): stable facts with provenance and confidence
- `dynamic.json`: last N days' high-signal context + active threads

**Practical Rules:**
- Static accepts only "stable" fields (preferred stack, long-term project, writing preferences)
- Dynamic stores: current goals, active tasks, recent decisions
- Capped by size/time (last 14-30 days)
- Include provenance pointers back to events.jsonl (auditable and reversible)

#### 2. Automatic Forgetting/Decay
**Position: Cheap, improves quality immediately**

> Your append-only log will cause "context drag." Decay gives predictable retrieval quality.

**Decay Policy:**
- Facts persist unless contradicted, but can be demoted if stale
- Episodes decay by time and lack of reinforcement

**Mechanics (per memory item):**
```
- last_seen_at, created_at
- reinforcement_count (increment when retrieved/used)
- stability tag: fact | preference | episode | task_state
- rank = semantic_score * (1 + log(1+reinforcement)) * recency_boost(stability)
```

**"Forgetting" = downranking + compaction, NOT deletion**
- Move decayed episodes to `archive/events-YYYY-MM.jsonl`

#### 3. Local Semantic Search (<300ms)
**Position: Yes, doable locally at $0**

> Without semantic retrieval, graph and fact extraction won't pay off.

**Stack:**
- Local embedding model (open-source)
- ANN index on disk

**File Layout:**
- `index/embeddings.sqlite` — memory_id, vector, text, type, tags, updated_at
- `index/ann.faiss` (or hnswlib) — rebuilt incrementally

**Reality Check:**
- <300ms realistic for 10k-100k memories with ANN
- Trick: incremental indexing + bounded candidates (top 50-200, then rerank)
- SQLite is still "file-based" and much faster than JSON parsing

#### 4. Graph Memory Relationships
**Position: Thin layer, not full knowledge graph**

> Relationships are where Supermemory feels "smart," but you don't need heavy graph DBs.

**Minimal Viable Graph (file-based):**
- `graph/edges.jsonl` (append-only): `{from_id, rel, to_id, weight, created_at, evidence_event_id}`
- `graph/nodes.json` (optional cache): node metadata + rollups

**Usage in Retrieval:**
1. After semantic top-k retrieval
2. Expand one hop along UPDATES/EXTENDS/DERIVES
3. Collapse duplicates, apply CONTRADICTS resolution

#### 5. Automatic Fact Extraction
**Position: Only if constrained to schemas + triggers**

> Without paid LLMs, open-ended extraction is unreliable. Bounded extraction is workable.

**Do THIS Instead of "Extract Everything":**
- Define 10-30 fact schemas you care about: UserPreference, Project, TechStack, RecurringTask, Constraint, Definition, Decision
- Extraction sources: explicit commands ("remember that…"), deterministic regex, optional local LLM

**Update Logic:**
- New fact = candidate with provenance
- Promote to state.json only if: repeated (≥2) OR explicitly confirmed, not contradicted
- Otherwise keep in dynamic.json with short TTL

**What NOT to Copy (Yet):**
1. Fully automatic UPDATES/EXTENDS/DERIVES inference (too noisy without LLM)
2. Aggressive auto-forgetting via deletion (want auditability)

**Summary — The "Adopt Set":**
1. Static/Dynamic profiles
2. Decay/downranking + archiving
3. Local semantic retrieval with on-disk ANN index
4. Lightweight graph edges (post-retrieval expansion)
5. Schema-based extraction (opt-in, provenance-first)

---

### 🟡 GEMINI (Unavailable)

Gemini CLI timed out during this session. Unable to get initial position.

---

## Synthesis: Top 3 Ideas for Immediate Implementation

Based on STRONG CONSENSUS from Grok and ChatGPT:

### 1️⃣ STATIC + DYNAMIC PROFILE SPLIT
**Effort:** Low | **Impact:** High | **Risk:** Low

**Implementation:**
```
memory/
├── state.json          → Rename to static_profile.json (stable facts)
├── dynamic.json        → NEW: recent context, 14-30 day window
└── events.jsonl        → Keep as-is (provenance source)
```

**Schema for static_profile.json:**
```json
{
  "user": {...},
  "preferences": {...},
  "long_term_goals": [...],
  "constraints": [...],
  "last_verified": "timestamp"
}
```

**Schema for dynamic.json:**
```json
{
  "active_threads": [...],
  "recent_decisions": [...],
  "current_tasks": [...],
  "context_window_days": 14,
  "last_compacted": "timestamp"
}
```

### 2️⃣ DECAY/DOWNRANKING POLICY
**Effort:** Medium | **Impact:** High | **Risk:** Low

**Add to every memory item:**
```json
{
  "id": "...",
  "content": "...",
  "created_at": "timestamp",
  "last_seen_at": "timestamp",
  "reinforcement_count": 0,
  "stability": "fact|preference|episode|task_state",
  "confidence": 0.0-1.0
}
```

**Ranking Formula:**
```
rank = relevance_score * (1 + log(1 + reinforcement_count)) * recency_boost(stability)
```

**Archival Policy:**
- Episodes older than 30 days with reinforcement_count < 2 → archive
- Facts never deleted, only demoted
- Archive to `archive/events-YYYY-MM.jsonl`

### 3️⃣ LOCAL SEMANTIC SEARCH
**Effort:** High | **Impact:** Highest | **Risk:** Medium

**Tech Stack (all free, local):**
- `sentence-transformers` (all-MiniLM-L6-v2) — embeddings
- `FAISS` or `hnswlib` — ANN index
- `SQLite` — vector storage (faster than JSON)

**File Layout:**
```
index/
├── embeddings.db       → SQLite: id, text, vector, type, updated_at
└── ann.faiss           → FAISS index file
```

**Latency Target:** <300ms for 10k-100k memories

---

## Prioritized Roadmap

| Phase | Concept | Effort | Time | Dependencies |
|-------|---------|--------|------|--------------|
| 1 | Static/Dynamic Profiles | Low | 1 day | None |
| 2 | Decay Policy + Archival | Medium | 2-3 days | Phase 1 |
| 3 | Local Semantic Search | High | 1 week | Phase 2 |
| 4 | Graph Relationships | Medium | 3-5 days | Phase 3 |
| 5 | Bounded Fact Extraction | High | 1+ week | Phase 4 |

---

## Key Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Bad extractions pollute state | Require explicit triggers or repeated evidence; store provenance; allow rollback |
| Semantic search adds complexity | Isolate behind `memory_index/` module; keep raw data in existing files |
| Graph becomes inconsistent | Keep edges append-only; derive views/caches; treat graph as "assistive," not authoritative |

---

## Council Verdict

**ADOPT ALL FIVE CONCEPTS** incrementally, in this order:

1. **Profiles (immediate)** — Split state.json today
2. **Decay (this week)** — Add metadata fields, implement ranking
3. **Semantic Search (next sprint)** — sentence-transformers + FAISS
4. **Graph (after search works)** — Simple edges.jsonl file
5. **Extraction (carefully)** — Schema-constrained, provenance-tracked

**$0 budget constraint is NOT a blocker.** All tools are free and local:
- spaCy, sentence-transformers, FAISS, SQLite, networkx

**Key Principle:** Treat these as *data structures + policies + indexing*, not as a product requiring cloud APIs.

---

## Next Steps for Francisco

1. **Approve this roadmap** — or request modifications
2. **Phase 1 PR:** I can implement static/dynamic profile split today
3. **Decide on SQLite:** ChatGPT recommends it over pure JSON for speed. Approve?

---

*Session Duration: ~45 minutes*
*Round 1 Only (cross-examination skipped due to time)*
*Note: Gemini CLI unavailable — two-AI consensus used*
