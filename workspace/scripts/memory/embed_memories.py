#!/usr/bin/env python3
"""
Memory Embedding System for OpenClaw
Generates embeddings for semantic retrieval using local models (free) or API.

Usage:
    python embed_memories.py --rebuild     # Rebuild entire index
    python embed_memories.py --incremental # Only embed new entries
    python embed_memories.py --query "search text"  # Test search

Embeddings stored in memory/embeddings/
"""

import argparse
import json
import os
import sys
import hashlib
import numpy as np
from datetime import datetime
from pathlib import Path
from typing import Optional

# Paths
WORKSPACE = Path(os.environ.get("CLAWD_WORKSPACE", Path.home() / "clawd"))
MEMORY_DIR = WORKSPACE / "memory"
EMBEDDINGS_DIR = MEMORY_DIR / "embeddings"
LEDGER_PATH = MEMORY_DIR / "ledger.jsonl"
INDEX_PATH = EMBEDDINGS_DIR / "index.json"
VECTORS_PATH = EMBEDDINGS_DIR / "vectors.npy"

# Ensure directories exist
EMBEDDINGS_DIR.mkdir(parents=True, exist_ok=True)

# Embedding config
EMBEDDING_DIM = 384  # Default for MiniLM
MAX_RESULTS = 10


def get_embedder():
    """Get the best available embedding model."""
    # Try sentence-transformers (best, free, local)
    try:
        from sentence_transformers import SentenceTransformer
        model = SentenceTransformer('all-MiniLM-L6-v2')
        print("Using sentence-transformers (local, free)", file=sys.stderr)
        return lambda texts: model.encode(texts, show_progress_bar=False)
    except ImportError:
        pass
    
    # Try OpenAI embeddings (paid but good)
    try:
        import openai
        client = openai.OpenAI()
        def embed_openai(texts):
            response = client.embeddings.create(
                model="text-embedding-3-small",
                input=texts
            )
            return np.array([e.embedding for e in response.data])
        print("Using OpenAI embeddings (API)", file=sys.stderr)
        return embed_openai
    except ImportError:
        pass
    
    # Fallback: TF-IDF (no dependencies, worse quality)
    print("Warning: No embedding model found. Install sentence-transformers:", file=sys.stderr)
    print("  pip install sentence-transformers", file=sys.stderr)
    print("Falling back to basic TF-IDF (lower quality)", file=sys.stderr)
    
    # Simple hash-based embeddings as last resort
    def hash_embed(texts):
        embeddings = []
        for text in texts:
            # Create deterministic pseudo-embedding from hash
            h = hashlib.sha256(text.lower().encode()).digest()
            vec = np.frombuffer(h[:EMBEDDING_DIM], dtype=np.uint8).astype(np.float32)
            vec = (vec - 128) / 128  # Normalize to [-1, 1]
            embeddings.append(vec / np.linalg.norm(vec))
        return np.array(embeddings)
    
    return hash_embed


def load_ledger() -> list[dict]:
    """Load all events from ledger."""
    events = []
    if LEDGER_PATH.exists():
        with open(LEDGER_PATH, encoding='utf-8', errors='replace') as f:
            for line in f:
                try:
                    events.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    return events


def load_daily_logs() -> list[dict]:
    """Load content from daily log files."""
    entries = []
    for log_file in sorted(MEMORY_DIR.glob("20??-??-??.md")):
        content = log_file.read_text(encoding='utf-8', errors='replace')
        # Split by headers
        sections = content.split("\n## ")
        for i, section in enumerate(sections):
            if section.strip():
                entries.append({
                    "id": f"{log_file.stem}:{i}",
                    "type": "daily_log",
                    "content": section[:2000],  # Truncate
                    "source": str(log_file),
                    "ts": log_file.stem
                })
    return entries


def load_memory_md() -> list[dict]:
    """Load MEMORY.md content."""
    memory_file = WORKSPACE / "MEMORY.md"
    if not memory_file.exists():
        return []
    
    content = memory_file.read_text(encoding='utf-8', errors='replace')
    sections = content.split("\n## ")
    entries = []
    for i, section in enumerate(sections):
        if section.strip():
            entries.append({
                "id": f"MEMORY:{i}",
                "type": "memory_md",
                "content": section[:2000],
                "source": "MEMORY.md",
                "ts": datetime.now().isoformat()
            })
    return entries


def build_index(embedder) -> tuple[dict, np.ndarray]:
    """Build complete embedding index."""
    # Collect all memory sources
    all_entries = []
    
    # Ledger events
    ledger_events = load_ledger()
    for event in ledger_events:
        all_entries.append({
            "id": event.get("id", "unknown"),
            "type": event.get("type", "fact"),
            "content": event.get("content", ""),
            "entity": event.get("entity", ""),
            "tags": event.get("tags", []),
            "priority": event.get("priority", "P2"),
            "ts": event.get("ts", ""),
            "source": "ledger"
        })
    
    # Daily logs
    all_entries.extend(load_daily_logs())
    
    # MEMORY.md
    all_entries.extend(load_memory_md())
    
    print(f"Building index for {len(all_entries)} entries...", file=sys.stderr)
    
    if not all_entries:
        print("No entries to index", file=sys.stderr)
        return {}, np.array([])
    
    # Create text for embedding (combine relevant fields)
    texts = []
    for entry in all_entries:
        text = entry.get("content", "")
        if entry.get("entity"):
            text = f"[{entry['entity']}] {text}"
        if entry.get("tags"):
            text = f"{text} #{' #'.join(entry['tags'])}"
        texts.append(text[:1000])  # Truncate for embedding
    
    # Generate embeddings
    print("Generating embeddings...", file=sys.stderr)
    vectors = embedder(texts)
    
    # Build index metadata
    index = {
        "version": 1,
        "created_at": datetime.now().isoformat(),
        "count": len(all_entries),
        "embedding_dim": vectors.shape[1] if len(vectors) > 0 else EMBEDDING_DIM,
        "entries": all_entries
    }
    
    return index, vectors


def save_index(index: dict, vectors: np.ndarray):
    """Save index and vectors to disk."""
    with open(INDEX_PATH, "w") as f:
        json.dump(index, f, indent=2)
    
    np.save(VECTORS_PATH, vectors)
    print(f"Saved index ({index['count']} entries) to {EMBEDDINGS_DIR}", file=sys.stderr)


def load_index() -> tuple[Optional[dict], Optional[np.ndarray]]:
    """Load existing index from disk."""
    if not INDEX_PATH.exists() or not VECTORS_PATH.exists():
        return None, None
    
    with open(INDEX_PATH) as f:
        index = json.load(f)
    
    vectors = np.load(VECTORS_PATH)
    return index, vectors


def search(query: str, top_k: int = MAX_RESULTS) -> list[dict]:
    """Search for similar memories."""
    index, vectors = load_index()
    if index is None or vectors is None or len(vectors) == 0:
        print("No index found. Run --rebuild first.", file=sys.stderr)
        return []
    
    embedder = get_embedder()
    query_vec = embedder([query])[0]
    
    # Cosine similarity
    similarities = np.dot(vectors, query_vec) / (
        np.linalg.norm(vectors, axis=1) * np.linalg.norm(query_vec) + 1e-8
    )
    
    # Get top results
    top_indices = np.argsort(similarities)[::-1][:top_k]
    
    results = []
    for idx in top_indices:
        entry = index["entries"][idx].copy()
        entry["score"] = float(similarities[idx])
        results.append(entry)
    
    return results


def main():
    parser = argparse.ArgumentParser(description="Memory embedding system")
    parser.add_argument("--rebuild", action="store_true", help="Rebuild entire index")
    parser.add_argument("--incremental", action="store_true", help="Update index incrementally")
    parser.add_argument("--query", help="Search for similar memories")
    parser.add_argument("--top-k", type=int, default=MAX_RESULTS, help="Number of results")
    
    args = parser.parse_args()
    
    if args.rebuild:
        embedder = get_embedder()
        index, vectors = build_index(embedder)
        save_index(index, vectors)
        print(f"Index rebuilt: {index['count']} entries", file=sys.stderr)
    
    elif args.incremental:
        # For now, just rebuild (could be smarter about detecting new entries)
        print("Incremental update (rebuilding for now)...", file=sys.stderr)
        embedder = get_embedder()
        index, vectors = build_index(embedder)
        save_index(index, vectors)
    
    elif args.query:
        results = search(args.query, args.top_k)
        print(json.dumps(results, indent=2))
    
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
