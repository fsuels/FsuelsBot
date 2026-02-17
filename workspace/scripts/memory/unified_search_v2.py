#!/usr/bin/env python3
"""
Unified Hybrid Search v2 for OpenClaw
BM25 + Semantic search with RRF (Reciprocal Rank Fusion)

Key improvements from GPT 5.2 evaluation:
1. True hybrid retrieval (BM25 + semantic)
2. RRF fusion (robust, tuning-free)
3. Entity-aware boosting from registry
4. Predicate-aware recency decay
5. min_score threshold properly applied

Formula:
  RRF_score(d) = sum(1 / (k + rank_i(d))) for each retrieval path
  final_score = RRF_score * entity_boost * recency_multiplier

Usage:
    python unified_search_v2.py "Francisco's timezone"
    python unified_search_v2.py --json "query"
"""

import argparse
import json
import math
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

# Add parent to path for imports
sys.path.insert(0, str(Path(__file__).parent))

# Paths
WORKSPACE = Path(os.environ.get("CLAWD_WORKSPACE", Path.home() / "clawd"))
MEMORY_DIR = WORKSPACE / "memory"
ENTITY_REGISTRY_PATH = MEMORY_DIR / "entity_registry.json"

# RRF constant (standard value)
RRF_K = 60

# Recency decay by predicate type
# Facts decay slowly; episodic logs decay faster
DECAY_HALF_LIFE = {
    "fact": 365,       # Facts: 1-year half-life
    "preference": 365, # Preferences: 1-year
    "decision": 180,   # Decisions: 6 months
    "constraint": 730, # Constraints: 2 years (almost permanent)
    "event": 30,       # Events: 30 days
    "log": 14,         # Logs: 2 weeks
    "default": 60      # Default: 2 months
}


class EntityRegistry:
    """Entity registry with alias normalization and lookup."""
    
    def __init__(self):
        self.entities: Dict[str, Dict] = {}
        self.aliases: Dict[str, str] = {}  # normalized_alias -> canonical
        self.canonical_aliases: Dict[str, Set[str]] = {}  # canonical -> {aliases}
    
    @classmethod
    def load(cls, path: Path = ENTITY_REGISTRY_PATH) -> Optional["EntityRegistry"]:
        """Load entity registry from disk."""
        if not path.exists():
            return None
        try:
            with open(path, encoding='utf-8') as f:
                data = json.load(f)
            
            reg = cls()
            reg.entities = data.get("entities", {})
            
            # Build alias lookup
            for alias, canonical in data.get("aliases", {}).items():
                normalized = cls.normalize(alias)
                reg.aliases[normalized] = canonical
                if canonical not in reg.canonical_aliases:
                    reg.canonical_aliases[canonical] = set()
                reg.canonical_aliases[canonical].add(alias)
            
            # Add canonical names as aliases to themselves
            for canonical in reg.entities.keys():
                normalized = cls.normalize(canonical)
                reg.aliases[normalized] = canonical
                if canonical not in reg.canonical_aliases:
                    reg.canonical_aliases[canonical] = set()
                reg.canonical_aliases[canonical].add(canonical)
            
            return reg
        except Exception as e:
            print(f"Warning: Could not load entity registry: {e}", file=sys.stderr)
            return None
    
    @staticmethod
    def normalize(text: str) -> str:
        """Normalize text for alias matching."""
        return re.sub(r'[^a-z0-9]', '', text.lower())
    
    def resolve(self, text: str) -> Optional[str]:
        """Resolve text to canonical entity name."""
        normalized = self.normalize(text)
        return self.aliases.get(normalized)
    
    def extract_entities(self, text: str) -> List[str]:
        """Extract canonical entities from text."""
        found = set()
        words = re.findall(r'\b\w+(?:\s+\w+)?\b', text)
        
        # Check single words and bigrams
        for i, word in enumerate(words):
            # Single word
            canonical = self.resolve(word)
            if canonical:
                found.add(canonical)
            
            # Bigram (check next word too)
            if i < len(words) - 1:
                bigram = f"{word} {words[i+1]}"
                canonical = self.resolve(bigram)
                if canonical:
                    found.add(canonical)
        
        return list(found)
    
    def get_all_variations(self, canonical: str) -> Set[str]:
        """Get all aliases for a canonical entity."""
        return self.canonical_aliases.get(canonical, {canonical})


_entity_registry: Optional[EntityRegistry] = None


def get_entity_registry() -> Optional[EntityRegistry]:
    """Get entity registry (cached)."""
    global _entity_registry
    if _entity_registry is None:
        _entity_registry = EntityRegistry.load()
    return _entity_registry


def calculate_entity_boost(query: str, doc: Dict[str, Any]) -> float:
    """
    Calculate entity boost for a document.
    
    Returns 0.5-2.0 multiplier:
    - 2.0: All query entities found in doc
    - 1.0: No entities in query (neutral)
    - 0.5: Query has entities but none found in doc
    """
    registry = get_entity_registry()
    if not registry:
        return 1.0
    
    query_entities = set(registry.extract_entities(query))
    if not query_entities:
        return 1.0  # No entities in query, neutral
    
    # Get doc text
    doc_text = " ".join([
        doc.get("content", ""),
        doc.get("text", ""),
        " ".join(doc.get("entities", []))
    ])
    
    doc_entities = set(registry.extract_entities(doc_text))
    
    # Calculate overlap
    overlap = query_entities & doc_entities
    
    if not overlap:
        return 0.5  # Penalty: query mentions entities not in doc
    
    # Boost based on coverage
    coverage = len(overlap) / len(query_entities)
    return 0.5 + 1.5 * coverage  # 0.5 to 2.0


def calculate_recency_multiplier(doc: Dict[str, Any], now: datetime) -> float:
    """
    Calculate recency multiplier using correct half-life formula.
    
    decay = 2^(-age / half_life)
    
    Returns 0.1-1.0 multiplier.
    """
    # Get timestamp
    ts_str = doc.get("ts", doc.get("timestamp", doc.get("date", "")))
    if not ts_str:
        return 0.5  # Unknown age, moderate decay
    
    try:
        if isinstance(ts_str, str):
            # Parse ISO format
            if 'T' in ts_str:
                ts = datetime.fromisoformat(ts_str.replace('Z', '+00:00'))
            else:
                ts = datetime.fromisoformat(ts_str + "T00:00:00+00:00")
        else:
            ts = ts_str
        
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
    except Exception:
        return 0.5
    
    # Calculate age in days
    age_days = (now - ts).total_seconds() / 86400
    if age_days < 0:
        age_days = 0
    
    # Get half-life based on document type
    doc_type = doc.get("type", "default")
    half_life = DECAY_HALF_LIFE.get(doc_type, DECAY_HALF_LIFE["default"])
    
    # Correct half-life formula: decay = 2^(-age / half_life)
    decay = math.pow(2, -age_days / half_life)
    
    # Floor at 0.1 (never fully decay)
    return max(0.1, decay)


def reciprocal_rank_fusion(
    result_lists: List[List[Dict[str, Any]]],
    id_key: str = "id",
    k: int = RRF_K
) -> List[Dict[str, Any]]:
    """
    Reciprocal Rank Fusion (RRF) for combining multiple result lists.
    
    RRF_score(d) = sum(1 / (k + rank_i(d))) for each list
    
    Args:
        result_lists: List of ranked result lists
        id_key: Key to use for document identity
        k: RRF constant (default 60)
        
    Returns:
        Fused results with rrf_score
    """
    scores: Dict[str, float] = {}
    docs: Dict[str, Dict[str, Any]] = {}
    
    for results in result_lists:
        for rank, doc in enumerate(results, start=1):
            # Get document ID
            doc_id = doc.get(id_key, doc.get("content", "")[:50])
            
            # Add RRF score
            if doc_id not in scores:
                scores[doc_id] = 0.0
                docs[doc_id] = doc
            
            scores[doc_id] += 1.0 / (k + rank)
    
    # Build result list with RRF scores
    fused = []
    for doc_id, rrf_score in scores.items():
        result = dict(docs[doc_id])
        result["rrf_score"] = round(rrf_score, 6)
        fused.append(result)
    
    # Sort by RRF score
    fused.sort(key=lambda x: x["rrf_score"], reverse=True)
    return fused


def unified_search_v2(
    query: str,
    top_k: int = 10,
    min_score: float = 0.0,
    use_bm25: bool = True,
    use_semantic: bool = True,
    prefer_recent: bool = False,
    explain: bool = False
) -> List[Dict[str, Any]]:
    """
    Hybrid search with RRF fusion.
    
    Args:
        query: Search query
        top_k: Number of results
        min_score: Minimum final score threshold
        use_bm25: Include BM25 retrieval
        use_semantic: Include semantic retrieval
        prefer_recent: Boost recency (for temporal queries)
        explain: Add explanation fields to results
        
    Returns:
        List of results with final_score
    """
    result_lists = []
    
    # 1. BM25 retrieval
    if use_bm25:
        try:
            from bm25_search import bm25_search
            bm25_results = bm25_search(query, top_k=top_k * 3)
            result_lists.append(bm25_results)
        except ImportError:
            pass  # BM25 not available
    
    # 2. Semantic retrieval
    if use_semantic:
        try:
            from embed_memories import search as semantic_search
            semantic_results = semantic_search(query, top_k=top_k * 3)
            result_lists.append(semantic_results)
        except ImportError:
            pass  # Semantic not available
    
    if not result_lists:
        return []
    
    # 3. RRF fusion
    fused = reciprocal_rank_fusion(result_lists)
    
    # 4. Apply entity boost and recency
    now = datetime.now(timezone.utc)
    
    scored = []
    for doc in fused:
        rrf_score = doc.get("rrf_score", 0)
        
        # Entity boost
        entity_boost = calculate_entity_boost(query, doc)
        
        # Recency multiplier
        recency_mult = calculate_recency_multiplier(doc, now)
        if prefer_recent:
            recency_mult = recency_mult ** 0.5  # Softer decay when preferring recent
        
        # Priority boost
        priority = doc.get("priority", "P2")
        priority_boost = {"P0": 1.3, "P1": 1.1, "P2": 1.0, "P3": 0.9}.get(priority, 1.0)
        
        # Final score
        final_score = rrf_score * entity_boost * recency_mult * priority_boost
        
        doc["final_score"] = round(final_score, 6)
        
        if explain:
            doc["_explain"] = {
                "rrf_score": rrf_score,
                "entity_boost": round(entity_boost, 3),
                "recency_mult": round(recency_mult, 3),
                "priority_boost": priority_boost
            }
        
        if final_score >= min_score:
            scored.append(doc)
    
    # Sort by final score
    scored.sort(key=lambda x: x["final_score"], reverse=True)
    
    return scored[:top_k]


# Backward compatible wrapper
def unified_search(
    query: str,
    top_k: int = 10,
    min_score: float = 0.2,
    **kwargs
) -> List[Dict[str, Any]]:
    """Backward-compatible wrapper for unified_search_v2."""
    return unified_search_v2(query, top_k=top_k, min_score=min_score, **kwargs)


def format_results(results: List[Dict], as_json: bool = False) -> str:
    """Format results for display."""
    if as_json:
        return json.dumps(results, indent=2)
    
    if not results:
        return "No results found."
    
    lines = [f"Found {len(results)} results (BM25 + Semantic with RRF fusion)\n"]
    
    for i, r in enumerate(results, 1):
        final = r.get("final_score", 0)
        priority = r.get("priority", "P2")
        content = r.get("content", r.get("text", ""))[:120]
        
        lines.append(f"{i}. [{priority}] score={final:.4f}")
        lines.append(f"   {content}")
        
        if "_explain" in r:
            exp = r["_explain"]
            lines.append(f"   (rrf={exp['rrf_score']:.4f} entity={exp['entity_boost']:.2f} recency={exp['recency_mult']:.2f})")
        lines.append("")
    
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="Unified hybrid search v2")
    parser.add_argument("query", nargs="?", help="Search query")
    parser.add_argument("--json", action="store_true", help="Output as JSON")
    parser.add_argument("--top-k", type=int, default=10, help="Number of results")
    parser.add_argument("--min-score", type=float, default=0.0, help="Minimum score")
    parser.add_argument("--explain", action="store_true", help="Show scoring details")
    parser.add_argument("--no-bm25", action="store_true", help="Disable BM25")
    parser.add_argument("--no-semantic", action="store_true", help="Disable semantic")
    parser.add_argument("--prefer-recent", action="store_true", help="Boost recent results")
    
    args = parser.parse_args()
    
    if not args.query:
        args.query = sys.stdin.read().strip()
    
    if not args.query:
        parser.print_help()
        return
    
    results = unified_search_v2(
        args.query,
        top_k=args.top_k,
        min_score=args.min_score,
        use_bm25=not args.no_bm25,
        use_semantic=not args.no_semantic,
        prefer_recent=args.prefer_recent,
        explain=args.explain
    )
    
    print(format_results(results, args.json))


if __name__ == "__main__":
    main()
