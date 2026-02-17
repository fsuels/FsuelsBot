#!/usr/bin/env python3
"""
Unified Memory Search for OpenClaw
Combines semantic similarity + decay score + priority into composite ranking.

Formula: composite = (semantic_weight × similarity) + (recency_weight × decay) + (priority_weight × priority_score)

Default weights (tunable):
- semantic: 0.5
- recency: 0.3  
- priority: 0.2

Usage:
    python unified_search.py "what did we decide about pricing"
    python unified_search.py --json "query"
    python unified_search.py --weights 0.4 0.4 0.2 "query"  # custom weights
"""

import argparse
import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path

# Add parent to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from embed_memories import search as semantic_search, load_index
from decay_score import calculate_decay_score, load_access_log

# Paths
WORKSPACE = Path(__file__).parent.parent.parent
MEMORY_DIR = WORKSPACE / "memory"
ALIASES_PATH = MEMORY_DIR / "aliases.json"
GRAPH_PATH = MEMORY_DIR / "knowledge_graph.json"

# Default weights (must sum to 1.0 for additive mode)
DEFAULT_WEIGHTS = {
    "semantic": 0.5,
    "recency": 0.3,
    "priority": 0.2
}


def calculate_entity_salience(content: str, query: str) -> float:
    """
    Calculate entity salience: how relevant are the entities in this memory
    to the current query context.
    
    Returns 0.5-1.5 multiplier (neutral to boosted).
    """
    # Load entity data
    try:
        if ALIASES_PATH.exists():
            with open(ALIASES_PATH) as f:
                aliases_data = json.load(f)
        else:
            return 1.0  # Neutral if no aliases
    except:
        return 1.0
    
    # Extract entities from query and content
    canonical_entities = set(aliases_data.get("canonical_entities", {}).keys())
    aliases = aliases_data.get("aliases", {})
    
    def find_entities(text: str) -> set:
        """Find canonical entities mentioned in text."""
        text_lower = text.lower()
        found = set()
        
        # Check canonical names
        for entity in canonical_entities:
            if entity.lower() in text_lower:
                found.add(entity)
        
        # Check aliases
        for alias, canonical in aliases.items():
            if alias in text_lower:
                found.add(canonical)
        
        return found
    
    query_entities = find_entities(query)
    content_entities = find_entities(content)
    
    if not query_entities:
        return 1.0  # No entities in query, neutral salience
    
    # Calculate overlap
    overlap = query_entities & content_entities
    
    if not overlap:
        return 0.7  # Penalty for no entity match
    
    # Boost based on entity match ratio
    match_ratio = len(overlap) / len(query_entities)
    
    # Also consider entity importance (from knowledge graph mentions)
    try:
        if GRAPH_PATH.exists():
            import networkx as nx
            with open(GRAPH_PATH) as f:
                graph_data = json.load(f)
            G = nx.node_link_graph(graph_data, multigraph=True, directed=True)
            
            # Sum mentions of matched entities
            total_mentions = 0
            for entity in overlap:
                if entity in G.nodes:
                    total_mentions += G.nodes[entity].get("mentions", 1)
            
            # Normalize (log scale to avoid huge numbers dominating)
            mention_boost = min(1 + math.log10(max(total_mentions, 1)) * 0.1, 1.5)
        else:
            mention_boost = 1.0
    except:
        mention_boost = 1.0
    
    # Final salience: base 0.8-1.2 from match ratio, boosted by mentions
    salience = (0.8 + 0.4 * match_ratio) * mention_boost
    
    return min(salience, 1.5)  # Cap at 1.5x

# Priority to numeric score
PRIORITY_SCORES = {
    "P0": 1.0,
    "P1": 0.8,
    "P2": 0.6,
    "P3": 0.4
}


def unified_search(
    query: str,
    top_k: int = 10,
    weights: dict = None,
    min_score: float = 0.2,
    trust_filter: str = None,
    formula: str = "additive"
) -> list[dict]:
    """
    Search memories with composite scoring.
    
    Args:
        query: Search query
        top_k: Number of results to return
        weights: Dict with semantic/recency/priority weights
        min_score: Minimum composite score threshold
        formula: "additive" (default, weighted sum) or "multiplicative" (Arena formula)
                 multiplicative: relevance = semantic × recency × entity_salience
        
    Returns:
        List of results with composite_score, semantic_score, decay_score, priority_score, entity_salience
    """
    if weights is None:
        weights = DEFAULT_WEIGHTS
    
    # Normalize weights
    total = sum(weights.values())
    weights = {k: v/total for k, v in weights.items()}
    
    # Get semantic search results (fetch more than needed for re-ranking)
    semantic_results = semantic_search(query, top_k=top_k * 5)
    
    if not semantic_results:
        return []
    
    # Load access log for decay calculation
    access_counts = load_access_log()
    now = datetime.now(timezone.utc)
    
    # Calculate composite scores
    scored_results = []
    for result in semantic_results:
        # Semantic score (already 0-1 from cosine similarity)
        semantic_score = result.get("score", 0)
        
        # Build event dict for decay calculation
        event = {
            "id": result.get("id", ""),
            "type": result.get("type", "fact"),
            "priority": result.get("priority", "P2"),
            "ts": result.get("ts", ""),
            "content": result.get("content", "")
        }
        
        # Decay score (0-1)
        decay_score = calculate_decay_score(event, now, access_counts)
        
        # Priority score (0-1)
        priority = result.get("priority", "P2")
        priority_score = PRIORITY_SCORES.get(priority, 0.6)
        
        # Entity salience (0.5-1.5 multiplier)
        content = result.get("content", "")
        entity_salience = calculate_entity_salience(content, query)
        
        # Composite score - two formula options
        if formula == "multiplicative":
            # Arena Round 2 formula: relevance = semantic × recency × salience
            # Boost by priority as well
            composite = semantic_score * decay_score * entity_salience * (0.7 + 0.3 * priority_score)
        else:
            # Additive formula (default, backward compatible)
            composite = (
                weights["semantic"] * semantic_score +
                weights["recency"] * decay_score +
                weights["priority"] * priority_score
            ) * entity_salience  # Salience as multiplier
        
        # Add scores to result
        result["composite_score"] = round(composite, 4)
        result["semantic_score"] = round(semantic_score, 4)
        result["decay_score"] = round(decay_score, 4)
        result["priority_score"] = round(priority_score, 4)
        result["entity_salience"] = round(entity_salience, 4)
        
        if composite >= min_score:
            # Apply trust level filter if specified
            if trust_filter:
                result_trust = result.get("trust_level", "internal")
                if trust_filter == "verified" and result_trust != "verified":
                    continue
                elif trust_filter == "internal+" and result_trust == "external":
                    continue  # Exclude external
            
            scored_results.append(result)
    
    # Sort by composite score
    scored_results.sort(key=lambda x: x["composite_score"], reverse=True)
    
    return scored_results[:top_k]


def format_results(results: list[dict], format_type: str = "text") -> str:
    """Format search results for display."""
    if not results:
        return "No results found."
    
    if format_type == "json":
        return json.dumps(results, indent=2)
    
    # Text format
    lines = []
    lines.append(f"Found {len(results)} results (composite scoring: semantic×0.5 + recency×0.3 + priority×0.2)")
    lines.append("")
    
    for i, r in enumerate(results, 1):
        composite = r.get("composite_score", 0)
        semantic = r.get("semantic_score", 0)
        decay = r.get("decay_score", 0)
        priority = r.get("priority", "P2")
        content = r.get("content", "")[:150]
        source = r.get("source", "unknown")
        
        lines.append(f"{i}. [{priority}] composite={composite:.3f} (sem={semantic:.2f}, dec={decay:.2f})")
        lines.append(f"   {content}")
        lines.append(f"   Source: {source}")
        lines.append("")
    
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="Unified memory search with composite scoring")
    parser.add_argument("query", nargs="?", help="Search query")
    parser.add_argument("--json", action="store_true", help="Output as JSON")
    parser.add_argument("--top-k", type=int, default=10, help="Number of results")
    parser.add_argument("--min-score", type=float, default=0.2, help="Minimum composite score")
    parser.add_argument("--weights", nargs=3, type=float, metavar=("SEM", "REC", "PRI"),
                       help="Custom weights for semantic, recency, priority (must sum to 1)")
    parser.add_argument("--trust", choices=["verified", "internal+", "all"], default="all",
                       help="Trust filter: verified (human only), internal+ (exclude external), all")
    parser.add_argument("--formula", choices=["additive", "multiplicative"], default="additive",
                       help="Scoring formula: additive (weighted sum) or multiplicative (Arena R2)")
    
    args = parser.parse_args()
    
    if not args.query:
        args.query = sys.stdin.read().strip()
    
    if not args.query:
        parser.print_help()
        sys.exit(1)
    
    # Check index exists
    index, _ = load_index()
    if index is None:
        print("Error: No embedding index found.", file=sys.stderr)
        print("Run: python embed_memories.py --rebuild", file=sys.stderr)
        sys.exit(1)
    
    # Parse custom weights
    weights = DEFAULT_WEIGHTS.copy()
    if args.weights:
        weights = {
            "semantic": args.weights[0],
            "recency": args.weights[1],
            "priority": args.weights[2]
        }
    
    # Search
    trust_filter = None if args.trust == "all" else args.trust
    results = unified_search(
        args.query,
        top_k=args.top_k,
        weights=weights,
        min_score=args.min_score,
        trust_filter=trust_filter,
        formula=args.formula
    )
    
    # Output
    output = format_results(results, "json" if args.json else "text")
    print(output)


if __name__ == "__main__":
    main()
