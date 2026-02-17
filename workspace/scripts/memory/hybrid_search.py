#!/usr/bin/env python3
"""
Hybrid Search for OpenClaw
Combines semantic search + knowledge graph traversal.

Multi-pathway retrieval:
1. Semantic: Embedding similarity search
2. Graph: Entity extraction → graph traversal → related memories
3. Merge: Combine and deduplicate results

Usage:
    python hybrid_search.py "what problems affect DLM"
    python hybrid_search.py --json "query"
    python hybrid_search.py --graph-weight 0.4 "query"  # boost graph results
"""

import argparse
import json
import re
import sys
from pathlib import Path

# Add parent to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from unified_search import unified_search
from knowledge_graph import load_graph, traverse, spreading_activation, get_activated_events, ENTITY_PATTERNS

# Paths
WORKSPACE = Path.home() / "clawd"
MEMORY_DIR = WORKSPACE / "memory"
LEDGER_PATH = MEMORY_DIR / "ledger.jsonl"

# Default graph weight (how much to boost graph-connected results)
DEFAULT_GRAPH_WEIGHT = 0.3


def extract_query_entities(query: str) -> list[str]:
    """Extract entities from query using knowledge graph patterns."""
    entities = []
    for entity_type, pattern in ENTITY_PATTERNS.items():
        matches = re.findall(pattern, query, re.IGNORECASE)
        for match in matches:
            # Normalize
            normalized = match.strip()
            if normalized.lower() in ("dlm", "dress like mommy"):
                normalized = "DLM"
            elif normalized.lower() in ("gmc", "google merchant center"):
                normalized = "GMC"
            entities.append(normalized)
    return list(set(entities))


def get_graph_connected_events(entities: list[str], hops: int = 2, use_activation: bool = True) -> dict[str, float]:
    """
    Get event IDs connected to entities via graph.
    Uses spreading activation for relevance scoring.
    Returns dict of event_id -> connection_strength (0-1).
    """
    G = load_graph()
    if G is None:
        return {}
    
    connected_events = {}
    
    if use_activation and entities:
        # Use spreading activation (SYNAPSE-style)
        activations = spreading_activation(
            G, 
            entities, 
            initial_activation=1.0,
            decay=0.5,
            threshold=0.05
        )
        
        # Get events from activated nodes
        events = get_activated_events(G, activations)
        for event in events:
            event_id = event.get("event_id", "")
            if event_id:
                strength = event.get("activation", 0.5)
                if event_id in connected_events:
                    connected_events[event_id] = min(1.0, connected_events[event_id] + strength)
                else:
                    connected_events[event_id] = strength
    else:
        # Fallback to BFS traversal
        for entity in entities:
            result = traverse(G, entity, hops=hops)
            if "error" in result:
                continue
            
            for edge in result.get("edges", []):
                event_id = edge.get("event_id", "")
                depth = edge.get("depth", 1)
                
                if event_id:
                    strength = 1.0 / depth
                    if event_id in connected_events:
                        connected_events[event_id] = min(1.0, connected_events[event_id] + strength)
                    else:
                        connected_events[event_id] = strength
    
    return connected_events


def load_events_by_id(event_ids: set[str]) -> dict[str, dict]:
    """Load events from ledger by ID."""
    events = {}
    if not LEDGER_PATH.exists():
        return events
    
    with open(LEDGER_PATH, encoding='utf-8', errors='replace') as f:
        for line in f:
            try:
                event = json.loads(line)
                eid = event.get("id", "")
                if eid in event_ids:
                    events[eid] = event
            except json.JSONDecodeError:
                continue
    
    return events


def hybrid_search(
    query: str,
    top_k: int = 10,
    graph_weight: float = DEFAULT_GRAPH_WEIGHT,
    hops: int = 2,
    min_score: float = 0.15
) -> list[dict]:
    """
    Multi-pathway search combining semantic + graph traversal.
    
    Args:
        query: Search query
        top_k: Number of results
        graph_weight: How much to boost graph-connected results (0-1)
        hops: Graph traversal depth
        min_score: Minimum final score
        
    Returns:
        List of results with hybrid_score
    """
    # 1. Get semantic results
    semantic_results = unified_search(query, top_k=top_k * 3, min_score=0.1)
    
    # Build result dict by ID
    results_by_id = {}
    for r in semantic_results:
        rid = r.get("id", r.get("content", "")[:50])
        results_by_id[rid] = r
        r["graph_boost"] = 0.0
        r["hybrid_score"] = r.get("composite_score", 0)
    
    # 2. Extract entities from query
    entities = extract_query_entities(query)
    
    # 3. If entities found, do graph traversal
    if entities:
        graph_connections = get_graph_connected_events(entities, hops=hops)
        
        # Boost results that are graph-connected
        for event_id, strength in graph_connections.items():
            if event_id in results_by_id:
                # Boost existing result
                boost = graph_weight * strength
                results_by_id[event_id]["graph_boost"] = round(boost, 4)
                results_by_id[event_id]["hybrid_score"] = round(
                    results_by_id[event_id]["composite_score"] + boost, 4
                )
            else:
                # Add graph-only result (not in semantic results)
                events = load_events_by_id({event_id})
                if event_id in events:
                    event = events[event_id]
                    new_result = {
                        "id": event_id,
                        "content": event.get("content", ""),
                        "type": event.get("type", "fact"),
                        "priority": event.get("priority", "P2"),
                        "ts": event.get("ts", ""),
                        "source": "graph",
                        "semantic_score": 0.0,
                        "decay_score": 0.5,  # Assume moderate
                        "priority_score": 0.6,
                        "composite_score": 0.0,
                        "graph_boost": round(graph_weight * strength, 4),
                        "hybrid_score": round(graph_weight * strength, 4)
                    }
                    results_by_id[event_id] = new_result
    
    # 4. Convert to list and sort by hybrid score
    results = list(results_by_id.values())
    results.sort(key=lambda x: x["hybrid_score"], reverse=True)
    
    # Filter by min score
    results = [r for r in results if r["hybrid_score"] >= min_score]
    
    return results[:top_k]


def format_results(results: list[dict], format_type: str = "text") -> str:
    """Format results for display."""
    if not results:
        return "No results found."
    
    if format_type == "json":
        return json.dumps(results, indent=2)
    
    lines = []
    lines.append(f"Found {len(results)} results (hybrid: semantic + graph traversal)")
    lines.append("")
    
    for i, r in enumerate(results, 1):
        hybrid = r.get("hybrid_score", 0)
        composite = r.get("composite_score", 0)
        graph_boost = r.get("graph_boost", 0)
        priority = r.get("priority", "P2")
        content = r.get("content", "")[:150]
        source = r.get("source", "unknown")
        
        boost_str = f"+{graph_boost:.2f}" if graph_boost > 0 else ""
        lines.append(f"{i}. [{priority}] hybrid={hybrid:.3f} (composite={composite:.2f} {boost_str})")
        lines.append(f"   {content}")
        lines.append(f"   Source: {source}")
        lines.append("")
    
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="Hybrid search: semantic + graph")
    parser.add_argument("query", nargs="?", help="Search query")
    parser.add_argument("--json", action="store_true", help="Output as JSON")
    parser.add_argument("--top-k", type=int, default=10, help="Number of results")
    parser.add_argument("--graph-weight", type=float, default=DEFAULT_GRAPH_WEIGHT,
                       help="Graph connection boost weight (0-1)")
    parser.add_argument("--hops", type=int, default=2, help="Graph traversal depth")
    parser.add_argument("--min-score", type=float, default=0.15, help="Minimum hybrid score")
    
    args = parser.parse_args()
    
    if not args.query:
        args.query = sys.stdin.read().strip()
    
    if not args.query:
        parser.print_help()
        sys.exit(1)
    
    results = hybrid_search(
        args.query,
        top_k=args.top_k,
        graph_weight=args.graph_weight,
        hops=args.hops,
        min_score=args.min_score
    )
    
    output = format_results(results, "json" if args.json else "text")
    print(output)


if __name__ == "__main__":
    main()
