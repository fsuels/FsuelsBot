#!/usr/bin/env python3
"""
Unified Memory Search Facade for OpenClaw
Single entry point for all memory retrieval.

Replaces direct calls to semantic_search, unified_search, hybrid_search.

Modes:
  --auto     (default) Analyze query and pick best strategy
  --semantic Pure embedding similarity
  --unified  Semantic + decay + priority scoring
  --hybrid   Semantic + graph traversal + spreading activation
  --temporal Time-aware search (parses "last week" etc.)

Usage:
    python search.py "what did we decide about pricing"
    python search.py --hybrid "problems with DLM"
    python search.py --temporal "what happened yesterday"
    python search.py --json "query"
"""

import argparse
import json
import re
import sys
from pathlib import Path

# Add parent to path for imports
sys.path.insert(0, str(Path(__file__).parent))


def detect_query_type(query: str) -> str:
    """
    Analyze query to determine best search strategy.
    
    Returns: 'semantic' | 'unified' | 'hybrid' | 'temporal'
    """
    query_lower = query.lower()
    
    # Time patterns → temporal
    time_patterns = [
        r'\b(today|yesterday|last\s+week|this\s+week|last\s+month)\b',
        r'\b(\d+)\s+days?\s+ago\b',
        r'\b(when|what\s+time|what\s+date)\b',
    ]
    for pattern in time_patterns:
        if re.search(pattern, query_lower):
            return 'temporal'
    
    # Relationship/entity patterns → hybrid (uses graph)
    relationship_patterns = [
        r'\b(related\s+to|connected|depends\s+on|blocked\s+by)\b',
        r'\b(what\s+affects|what\s+caused|problems?\s+with)\b',
        r'\b(who|which\s+platform|what\s+business)\b',
    ]
    for pattern in relationship_patterns:
        if re.search(pattern, query_lower):
            return 'hybrid'
    
    # Decision/priority patterns → unified (uses decay + priority)
    priority_patterns = [
        r'\b(decide|decision|chose|priority|important|critical)\b',
        r'\b(constraint|commitment|must|never|always)\b',
        r'\b(P0|P1|high\s+priority)\b',
    ]
    for pattern in priority_patterns:
        if re.search(pattern, query_lower):
            return 'unified'
    
    # Default to unified (best general-purpose)
    return 'unified'


def search_semantic(query: str, top_k: int = 10, min_score: float = 0.3) -> list[dict]:
    """Pure semantic search."""
    from semantic_search import search, load_index
    
    index, _ = load_index()
    if index is None:
        return []
    
    from embed_memories import search as embed_search
    results = embed_search(query, top_k)
    return [r for r in results if r.get("score", 0) >= min_score]


def search_unified(query: str, top_k: int = 10, min_score: float = 0.2) -> list[dict]:
    """Semantic + decay + priority scoring."""
    from unified_search import unified_search
    return unified_search(query, top_k=top_k, min_score=min_score)


def search_hybrid(query: str, top_k: int = 10, min_score: float = 0.15) -> list[dict]:
    """Semantic + graph + spreading activation."""
    from hybrid_search import hybrid_search
    return hybrid_search(query, top_k=top_k, min_score=min_score)


def search_temporal(query: str, top_k: int = 10, min_score: float = 0.2) -> list[dict]:
    """Time-aware search."""
    from semantic_search import parse_time_hint, filter_by_time
    from unified_search import unified_search
    
    start_date, end_date, cleaned_query = parse_time_hint(query)
    
    # Get more results to filter
    results = unified_search(cleaned_query or query, top_k=top_k * 3, min_score=min_score)
    
    if start_date:
        results = filter_by_time(results, start_date, end_date)
    
    return results[:top_k]


def search(
    query: str,
    mode: str = "auto",
    top_k: int = 10,
    min_score: float = None
) -> dict:
    """
    Main search function.
    
    Args:
        query: Search query
        mode: 'auto', 'semantic', 'unified', 'hybrid', 'temporal'
        top_k: Number of results
        min_score: Minimum score threshold (auto-set per mode if None)
        
    Returns:
        {
            "query": str,
            "mode": str,
            "mode_detected": str (if auto),
            "results": list[dict],
            "count": int
        }
    """
    # Auto-detect mode
    detected_mode = None
    if mode == "auto":
        detected_mode = detect_query_type(query)
        mode = detected_mode
    
    # Set default min_score per mode
    if min_score is None:
        min_score = {
            "semantic": 0.3,
            "unified": 0.2,
            "hybrid": 0.15,
            "temporal": 0.2
        }.get(mode, 0.2)
    
    # Execute search
    search_fn = {
        "semantic": search_semantic,
        "unified": search_unified,
        "hybrid": search_hybrid,
        "temporal": search_temporal
    }.get(mode, search_unified)
    
    results = search_fn(query, top_k=top_k, min_score=min_score)
    
    response = {
        "query": query,
        "mode": mode,
        "results": results,
        "count": len(results)
    }
    
    if detected_mode:
        response["mode_detected"] = detected_mode
    
    return response


def format_results(response: dict, format_type: str = "text") -> str:
    """Format search response for display."""
    if format_type == "json":
        return json.dumps(response, indent=2)
    
    lines = []
    mode = response["mode"]
    detected = response.get("mode_detected")
    count = response["count"]
    
    mode_str = f"{mode}" + (f" (auto-detected)" if detected else "")
    lines.append(f"Search: {response['query']}")
    lines.append(f"Mode: {mode_str} | Results: {count}")
    lines.append("")
    
    for i, r in enumerate(response["results"], 1):
        # Get best available score
        score = r.get("hybrid_score") or r.get("composite_score") or r.get("score", 0)
        priority = r.get("priority", "P2")
        content = r.get("content", "")[:150]
        
        lines.append(f"{i}. [{priority}] {score:.3f}")
        lines.append(f"   {content}")
        lines.append("")
    
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(
        description="Unified memory search",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Modes:
  auto      Analyze query, pick best strategy (default)
  semantic  Pure embedding similarity
  unified   Semantic + decay + priority
  hybrid    Semantic + graph traversal
  temporal  Time-aware (parses "last week" etc.)

Examples:
  python search.py "what did we decide about pricing"
  python search.py --hybrid "problems with DLM"
  python search.py --temporal "what happened yesterday"
        """
    )
    parser.add_argument("query", nargs="?", help="Search query")
    parser.add_argument("--auto", action="store_const", const="auto", dest="mode", help="Auto-detect mode (default)")
    parser.add_argument("--semantic", action="store_const", const="semantic", dest="mode", help="Pure semantic search")
    parser.add_argument("--unified", action="store_const", const="unified", dest="mode", help="Semantic + decay + priority")
    parser.add_argument("--hybrid", action="store_const", const="hybrid", dest="mode", help="Semantic + graph")
    parser.add_argument("--temporal", action="store_const", const="temporal", dest="mode", help="Time-aware search")
    parser.add_argument("--json", action="store_true", help="Output as JSON")
    parser.add_argument("--top-k", type=int, default=10, help="Number of results")
    parser.add_argument("--min-score", type=float, help="Minimum score threshold")
    
    parser.set_defaults(mode="auto")
    args = parser.parse_args()
    
    if not args.query:
        args.query = sys.stdin.read().strip()
    
    if not args.query:
        parser.print_help()
        sys.exit(1)
    
    # Run search
    response = search(
        args.query,
        mode=args.mode,
        top_k=args.top_k,
        min_score=args.min_score
    )
    
    # Output
    output = format_results(response, "json" if args.json else "text")
    print(output)


if __name__ == "__main__":
    main()
