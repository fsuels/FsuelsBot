# Memory System v2 - Hybrid Evolution

Upgraded memory system based on global AI research (5-agent swarm covering China, Europe, Academic, Production, Unconventional approaches).

## Components

### 1. Fact Extraction (`extract_facts.py`)

Automatically extracts facts, preferences, decisions from conversations.

```bash
# From session transcript
python extract_facts.py --session /path/to/session.jsonl

# From text
python extract_facts.py --text "Francisco said we should focus on SEO first"

# Dry run (don't append to ledger)
python extract_facts.py --text "..." --dry-run
```

### 2. Semantic Search (`embed_memories.py` + `semantic_search.py`)

Embedding-based retrieval using local MiniLM model (free, fast).

```bash
# Build/rebuild index
python embed_memories.py --rebuild

# Search
python semantic_search.py "what did we decide about pricing"
python semantic_search.py --json "query"  # JSON output
```

### 3. Decay Scoring (`decay_score.py`)

Ebbinghaus-inspired forgetting curve for relevance scoring.

```bash
# Score all memories
python decay_score.py --score-all

# See candidates for pruning
python decay_score.py --prune --threshold 0.1 --dry-run

# Log access to memory (boosts score)
python decay_score.py --log-access EVT-20260214-abc123
```

### 4. Consolidation (`consolidate.py`)

Weekly/monthly summarization of daily logs.

```bash
# Weekly consolidation
python consolidate.py --weekly

# Monthly consolidation
python consolidate.py --monthly

# Dry run
python consolidate.py --weekly --dry-run
```

## Architecture

```
memory/
├── ledger.jsonl          # Structured events (facts, decisions, etc.)
├── extracted/            # Auto-extracted facts (for review)
├── embeddings/
│   ├── index.json        # Metadata for all embedded memories
│   └── vectors.npy       # NumPy array of embeddings
├── consolidated/         # Weekly/monthly summaries
├── access_log.jsonl      # Memory access tracking (for decay)
└── YYYY-MM-DD.md         # Daily logs
```

## How It Works

1. **Extraction**: After conversations, `extract_facts.py` pulls out key information
2. **Embedding**: `embed_memories.py` creates vector representations for semantic search
3. **Retrieval**: `semantic_search.py` finds relevant memories by meaning, not just keywords
4. **Decay**: `decay_score.py` ranks memories by importance × recency × access frequency
5. **Consolidation**: `consolidate.py` summarizes old daily logs into themes

## Key Improvements Over v1

| Before                      | After                        |
| --------------------------- | ---------------------------- |
| Manual fact entry           | Auto-extraction via LLM      |
| Text matching               | Semantic similarity (<200ms) |
| Everything persists forever | Decay scoring + pruning      |
| Daily logs pile up          | Weekly consolidation         |

## Dependencies

```bash
pip install sentence-transformers anthropic
```

## Integration Points

- OpenClaw `memory_search` tool → calls `semantic_search.py`
- Post-session hook → calls `extract_facts.py`
- Weekly cron → calls `consolidate.py --weekly`
- Monthly cron → calls `consolidate.py --monthly`

## Research Basis

Based on findings from:

- **Mem0**: Fact extraction + graph memory
- **FadeMem**: Ebbinghaus forgetting curves
- **TraceMem**: Hierarchical consolidation
- **RGMem** (Alibaba): Multi-scale evolution
- **Letta/MemGPT**: Agent-managed memory

See `/research/ai-memory-solutions-2026.md` for full research report.
