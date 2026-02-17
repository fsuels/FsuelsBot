#!/usr/bin/env python3
"""
BM25 Lexical Search for OpenClaw Memory System
Implements Okapi BM25 for exact token matching.

Combined with semantic search via RRF fusion in unified_search.py

Usage:
    python bm25_search.py "Francisco timezone"
    python bm25_search.py --rebuild  # Rebuild index
"""

import argparse
import json
import math
import os
import pickle
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# Paths
WORKSPACE = Path(os.environ.get("CLAWD_WORKSPACE", Path.home() / "clawd"))
MEMORY_DIR = WORKSPACE / "memory"
LEDGER_PATH = MEMORY_DIR / "ledger.jsonl"
BM25_INDEX_PATH = MEMORY_DIR / "bm25_index.pkl"

# BM25 parameters
K1 = 1.2  # Term frequency saturation
B = 0.75  # Length normalization

# Stopwords (minimal set for memory search)
STOPWORDS = {
    'a', 'an', 'the', 'and', 'or', 'but', 'is', 'are', 'was', 'were',
    'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
    'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as',
    'into', 'through', 'during', 'before', 'after', 'above', 'below',
    'this', 'that', 'these', 'those', 'it', 'its', 'what', 'which',
    'who', 'whom', 'when', 'where', 'why', 'how', 'all', 'each',
    'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no',
    'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very',
    'can', 'will', 'just', 'should', 'now', 'i', 'me', 'my', 'we', 'our',
    'you', 'your', 'he', 'him', 'his', 'she', 'her', 'they', 'them', 'their'
}


def tokenize(text: str) -> List[str]:
    """
    Tokenize text with normalization.
    - Lowercase
    - Split on non-alphanumeric (preserve apostrophes in contractions)
    - Remove stopwords
    """
    text = text.lower()
    # Replace curly quotes with straight
    text = re.sub(r"[\u2018\u2019]", "'", text)
    # Split on non-alphanumeric except apostrophes
    tokens = re.findall(r"[a-z0-9]+(?:'[a-z]+)?", text)
    # Remove stopwords
    return [t for t in tokens if t not in STOPWORDS and len(t) > 1]


def normalize_alias(text: str) -> str:
    """Normalize text for alias matching."""
    return re.sub(r'[^a-z0-9]', '', text.lower())


class BM25Index:
    """BM25 index for memory documents."""
    
    def __init__(self):
        self.documents: List[Dict[str, Any]] = []  # Original docs
        self.doc_tokens: List[List[str]] = []  # Tokenized docs
        self.doc_lengths: List[int] = []
        self.avg_doc_length: float = 0
        self.doc_freq: Dict[str, int] = defaultdict(int)  # Token -> doc count
        self.inverted_index: Dict[str, List[Tuple[int, int]]] = defaultdict(list)  # Token -> [(doc_idx, term_freq)]
        self.n_docs: int = 0
    
    def add_document(self, doc: Dict[str, Any]) -> None:
        """Add a document to the index."""
        doc_idx = len(self.documents)
        self.documents.append(doc)
        
        # Combine searchable fields
        text = " ".join([
            doc.get("content", ""),
            doc.get("text", ""),
            doc.get("type", ""),
            " ".join(doc.get("entities", [])),
        ])
        
        tokens = tokenize(text)
        self.doc_tokens.append(tokens)
        self.doc_lengths.append(len(tokens))
        
        # Update term frequencies
        term_counts = Counter(tokens)
        for term, count in term_counts.items():
            if term not in [t for t, _ in self.inverted_index.get(term, [])]:
                self.doc_freq[term] += 1
            self.inverted_index[term].append((doc_idx, count))
        
        self.n_docs += 1
    
    def finalize(self) -> None:
        """Finalize index after all documents added."""
        if self.doc_lengths:
            self.avg_doc_length = sum(self.doc_lengths) / len(self.doc_lengths)
        else:
            self.avg_doc_length = 0
    
    def idf(self, term: str) -> float:
        """Calculate IDF for a term."""
        df = self.doc_freq.get(term, 0)
        if df == 0:
            return 0
        return math.log((self.n_docs - df + 0.5) / (df + 0.5) + 1)
    
    def score(self, query_tokens: List[str], doc_idx: int) -> float:
        """Calculate BM25 score for a document given query tokens."""
        score = 0.0
        doc_length = self.doc_lengths[doc_idx]
        
        # Get term frequencies for this doc
        doc_term_freq = Counter(self.doc_tokens[doc_idx])
        
        for term in query_tokens:
            if term not in doc_term_freq:
                continue
            
            tf = doc_term_freq[term]
            idf = self.idf(term)
            
            # BM25 formula
            numerator = tf * (K1 + 1)
            denominator = tf + K1 * (1 - B + B * (doc_length / self.avg_doc_length))
            score += idf * (numerator / denominator)
        
        return score
    
    def search(self, query: str, top_k: int = 10, min_score: float = 0.0) -> List[Dict[str, Any]]:
        """Search the index with a query."""
        query_tokens = tokenize(query)
        if not query_tokens:
            return []
        
        # Get candidate docs (any doc containing any query term)
        candidate_docs = set()
        for term in query_tokens:
            for doc_idx, _ in self.inverted_index.get(term, []):
                candidate_docs.add(doc_idx)
        
        # Score candidates
        scored = []
        for doc_idx in candidate_docs:
            bm25_score = self.score(query_tokens, doc_idx)
            if bm25_score >= min_score:
                result = dict(self.documents[doc_idx])
                result["bm25_score"] = round(bm25_score, 4)
                scored.append(result)
        
        # Sort by score
        scored.sort(key=lambda x: x["bm25_score"], reverse=True)
        return scored[:top_k]
    
    def save(self, path: Path) -> None:
        """Save index to disk."""
        data = {
            "documents": self.documents,
            "doc_tokens": self.doc_tokens,
            "doc_lengths": self.doc_lengths,
            "avg_doc_length": self.avg_doc_length,
            "doc_freq": dict(self.doc_freq),
            "inverted_index": dict(self.inverted_index),
            "n_docs": self.n_docs
        }
        with open(path, "wb") as f:
            pickle.dump(data, f)
    
    @classmethod
    def load(cls, path: Path) -> Optional["BM25Index"]:
        """Load index from disk."""
        if not path.exists():
            return None
        try:
            with open(path, "rb") as f:
                data = pickle.load(f)
            idx = cls()
            idx.documents = data["documents"]
            idx.doc_tokens = data["doc_tokens"]
            idx.doc_lengths = data["doc_lengths"]
            idx.avg_doc_length = data["avg_doc_length"]
            idx.doc_freq = defaultdict(int, data["doc_freq"])
            idx.inverted_index = defaultdict(list, data["inverted_index"])
            idx.n_docs = data["n_docs"]
            return idx
        except Exception as e:
            print(f"Warning: Could not load BM25 index: {e}", file=sys.stderr)
            return None


def load_ledger_events() -> List[Dict[str, Any]]:
    """Load events from ledger."""
    events = []
    if not LEDGER_PATH.exists():
        return events
    
    with open(LEDGER_PATH, encoding='utf-8', errors='replace') as f:
        for line in f:
            try:
                event = json.loads(line)
                events.append(event)
            except json.JSONDecodeError:
                continue
    return events


def build_index() -> BM25Index:
    """Build BM25 index from ledger events."""
    idx = BM25Index()
    
    events = load_ledger_events()
    for event in events:
        idx.add_document(event)
    
    idx.finalize()
    return idx


def rebuild_index() -> BM25Index:
    """Rebuild and save BM25 index."""
    print("Building BM25 index...")
    idx = build_index()
    idx.save(BM25_INDEX_PATH)
    print(f"Indexed {idx.n_docs} documents, saved to {BM25_INDEX_PATH}")
    return idx


_cached_index: Optional[BM25Index] = None


def get_index() -> Optional[BM25Index]:
    """Get BM25 index (cached)."""
    global _cached_index
    if _cached_index is not None:
        return _cached_index
    
    _cached_index = BM25Index.load(BM25_INDEX_PATH)
    if _cached_index is None:
        # Auto-build if missing
        _cached_index = rebuild_index()
    
    return _cached_index


def bm25_search(query: str, top_k: int = 10, min_score: float = 0.0) -> List[Dict[str, Any]]:
    """
    Search using BM25.
    
    Args:
        query: Search query
        top_k: Number of results
        min_score: Minimum BM25 score
        
    Returns:
        List of results with bm25_score
    """
    idx = get_index()
    if idx is None:
        return []
    return idx.search(query, top_k=top_k, min_score=min_score)


def main():
    parser = argparse.ArgumentParser(description="BM25 lexical search")
    parser.add_argument("query", nargs="?", help="Search query")
    parser.add_argument("--rebuild", action="store_true", help="Rebuild index")
    parser.add_argument("--top-k", type=int, default=10, help="Number of results")
    parser.add_argument("--json", action="store_true", help="Output as JSON")
    
    args = parser.parse_args()
    
    if args.rebuild:
        rebuild_index()
        return
    
    if not args.query:
        parser.print_help()
        return
    
    results = bm25_search(args.query, top_k=args.top_k)
    
    if args.json:
        print(json.dumps(results, indent=2))
    else:
        print(f"Found {len(results)} results")
        for i, r in enumerate(results, 1):
            score = r.get("bm25_score", 0)
            content = r.get("content", r.get("text", ""))[:100]
            print(f"{i}. [{score:.3f}] {content}")


if __name__ == "__main__":
    main()
