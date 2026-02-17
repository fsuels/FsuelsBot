#!/usr/bin/env python3
"""
Knowledge Graph for OpenClaw Memory System
Based on Zep/Graphiti temporal knowledge graph approach.

Entities and relationships extracted from ledger events.
Enables traversal queries: "What problems affect DLM?" → DLM → has_problem → GMC_suspension

Usage:
    python knowledge_graph.py --rebuild          # Rebuild graph from ledger
    python knowledge_graph.py --query "DLM"      # Find entity and connections
    python knowledge_graph.py --traverse "DLM" --hops 2  # Multi-hop traversal
    python knowledge_graph.py --related "GMC"    # Find related entities
"""

import argparse
import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Optional

import networkx as nx

# Paths
WORKSPACE = Path(os.environ.get("CLAWD_WORKSPACE", Path.home() / "clawd"))
MEMORY_DIR = WORKSPACE / "memory"
LEDGER_PATH = MEMORY_DIR / "ledger.jsonl"
GRAPH_PATH = MEMORY_DIR / "knowledge_graph.json"

# Entity extraction patterns
ENTITY_PATTERNS = {
    "person": r"\b(Francisco|Karina|Giselle|Amanda|Scott)\b",
    "business": r"\b(DLM|Dress Like Mommy|BuckyDrop|123LegalDoc|FKG Trading)\b",
    "platform": r"\b(Google Ads|Google Merchant Center|GMC|Microsoft Ads|TikTok|Pinterest|Facebook|Shopify|GA4)\b",
    "system": r"\b(FsuelsBot|McSuels|OpenClaw|Clawdbot|Mission Control)\b",
}

# Relationship patterns
RELATIONSHIP_KEYWORDS = {
    "owns": ["owns", "runs", "operates", "manages"],
    "has_problem": ["problem", "issue", "suspended", "blocked", "broken", "not working", "error"],
    "has_goal": ["goal", "wants", "needs", "target", "objective"],
    "decided": ["decided", "decision", "chose", "selected", "approved"],
    "depends_on": ["depends", "requires", "needs", "uses", "connected to"],
    "fixed": ["fixed", "resolved", "completed", "done", "working"],
    "blocked_by": ["blocked by", "waiting on", "needs"],
    "related_to": ["related", "about", "regarding", "concerning"],
}


def load_ledger() -> list[dict]:
    """Load events from ledger."""
    events = []
    if LEDGER_PATH.exists():
        with open(LEDGER_PATH, encoding='utf-8', errors='replace') as f:
            for line in f:
                try:
                    events.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    return events


def extract_entities(text: str) -> list[tuple[str, str]]:
    """Extract entities from text. Returns [(entity_name, entity_type), ...]"""
    entities = []
    for entity_type, pattern in ENTITY_PATTERNS.items():
        matches = re.findall(pattern, text, re.IGNORECASE)
        for match in matches:
            # Normalize entity name
            normalized = match.strip()
            # Map aliases
            if normalized.lower() in ("dlm", "dress like mommy"):
                normalized = "DLM"
            elif normalized.lower() in ("gmc", "google merchant center"):
                normalized = "GMC"
            entities.append((normalized, entity_type))
    return list(set(entities))


def extract_relationships(text: str, entities: list[tuple[str, str]]) -> list[tuple[str, str, str]]:
    """Extract relationships between entities. Returns [(source, rel_type, target), ...]"""
    relationships = []
    text_lower = text.lower()
    
    entity_names = [e[0] for e in entities]
    
    # Look for relationship keywords
    for rel_type, keywords in RELATIONSHIP_KEYWORDS.items():
        for keyword in keywords:
            if keyword in text_lower:
                # Simple heuristic: connect entities mentioned in same sentence
                # More sophisticated: use dependency parsing
                if len(entity_names) >= 2:
                    # Connect first entity to others with this relationship
                    source = entity_names[0]
                    for target in entity_names[1:]:
                        if source != target:
                            relationships.append((source, rel_type, target))
                elif len(entity_names) == 1:
                    # Single entity - create self-referential fact node
                    pass
    
    return list(set(relationships))


def build_graph(events: list[dict]) -> nx.MultiDiGraph:
    """Build knowledge graph from events."""
    G = nx.MultiDiGraph()
    
    for event in events:
        content = event.get("content", "")
        event_id = event.get("id", "unknown")
        event_type = event.get("type", "fact")
        timestamp = event.get("ts", "")
        priority = event.get("priority", "P2")
        
        # Extract entities
        entities = extract_entities(content)
        
        # Add entity nodes
        for entity_name, entity_type in entities:
            if not G.has_node(entity_name):
                G.add_node(entity_name, 
                          type=entity_type,
                          first_seen=timestamp,
                          mentions=0)
            G.nodes[entity_name]["mentions"] = G.nodes[entity_name].get("mentions", 0) + 1
            G.nodes[entity_name]["last_seen"] = timestamp
        
        # Extract and add relationships
        relationships = extract_relationships(content, entities)
        for source, rel_type, target in relationships:
            G.add_edge(source, target,
                      type=rel_type,
                      event_id=event_id,
                      event_type=event_type,
                      timestamp=timestamp,
                      priority=priority,
                      content=content[:200])
        
        # Also add explicit entity from event if present
        if event.get("entity"):
            entity_name = event["entity"]
            if not G.has_node(entity_name):
                G.add_node(entity_name, type="entity", first_seen=timestamp, mentions=1)
            else:
                G.nodes[entity_name]["mentions"] = G.nodes[entity_name].get("mentions", 0) + 1
    
    return G


def save_graph(G: nx.MultiDiGraph):
    """Save graph to JSON."""
    data = nx.node_link_data(G)
    with open(GRAPH_PATH, "w") as f:
        json.dump(data, f, indent=2)
    print(f"Saved graph: {G.number_of_nodes()} nodes, {G.number_of_edges()} edges", file=sys.stderr)


def load_graph() -> Optional[nx.MultiDiGraph]:
    """Load graph from JSON."""
    if not GRAPH_PATH.exists():
        return None
    with open(GRAPH_PATH) as f:
        data = json.load(f)
    return nx.node_link_graph(data, multigraph=True, directed=True)


# Merge history for audit
MERGE_HISTORY_PATH = MEMORY_DIR / "entity_merge_history.jsonl"


def merge_entities(keep: str, merge: str, reason: str = "manual") -> dict:
    """
    Merge two entities: all references to 'merge' become 'keep'.
    Updates knowledge graph and aliases. Records merge for audit.
    
    Args:
        keep: The canonical entity name to keep
        merge: The entity name to merge into 'keep'
        reason: Why this merge is happening (manual, auto, consolidation)
    
    Returns:
        dict with merge statistics
    """
    result = {
        "kept": keep,
        "merged": merge,
        "reason": reason,
        "edges_updated": 0,
        "success": False
    }
    
    # Load graph
    G = load_graph()
    if G is None:
        result["error"] = "No knowledge graph found"
        return result
    
    # Check entities exist
    if merge not in G:
        result["error"] = f"Entity '{merge}' not found in graph"
        return result
    
    # If keep doesn't exist, we'll create it with merge's attributes
    if keep not in G:
        G.add_node(keep, **G.nodes[merge])
    else:
        # Combine mention counts
        G.nodes[keep]["mentions"] = (
            G.nodes[keep].get("mentions", 0) + 
            G.nodes[merge].get("mentions", 0)
        )
        # Keep earliest first_seen
        if G.nodes[merge].get("first_seen", "Z") < G.nodes[keep].get("first_seen", "Z"):
            G.nodes[keep]["first_seen"] = G.nodes[merge]["first_seen"]
    
    # Update all edges pointing to/from 'merge' to point to/from 'keep'
    # Outgoing edges from merge -> X become keep -> X
    for _, target, key, data in list(G.out_edges(merge, keys=True, data=True)):
        if target != keep:  # Avoid self-loops
            G.add_edge(keep, target, key=key, **data)
            result["edges_updated"] += 1
    
    # Incoming edges from X -> merge become X -> keep
    for source, _, key, data in list(G.in_edges(merge, keys=True, data=True)):
        if source != keep:  # Avoid self-loops
            G.add_edge(source, keep, key=key, **data)
            result["edges_updated"] += 1
    
    # Remove the merged node
    G.remove_node(merge)
    
    # Save updated graph
    save_graph(G)
    
    # Update aliases
    try:
        aliases_path = MEMORY_DIR / "aliases.json"
        if aliases_path.exists():
            with open(aliases_path) as f:
                aliases_data = json.load(f)
            
            # Add merge as alias for keep
            aliases_data.setdefault("aliases", {})[merge.lower()] = keep
            
            # Update any aliases pointing to merged entity
            for alias, canonical in list(aliases_data.get("aliases", {}).items()):
                if canonical == merge:
                    aliases_data["aliases"][alias] = keep
            
            # Remove from canonical entities if present
            if merge in aliases_data.get("canonical_entities", {}):
                del aliases_data["canonical_entities"][merge]
            
            # Write atomically
            tmp = aliases_path.with_suffix(".tmp")
            with open(tmp, "w") as f:
                json.dump(aliases_data, f, indent=2)
            tmp.rename(aliases_path)
    except Exception as e:
        result["alias_update_error"] = str(e)
    
    # Record merge history
    merge_record = {
        "timestamp": datetime.now().isoformat(),
        "kept": keep,
        "merged": merge,
        "reason": reason,
        "edges_updated": result["edges_updated"]
    }
    with open(MERGE_HISTORY_PATH, "a") as f:
        f.write(json.dumps(merge_record) + "\n")
    
    result["success"] = True
    return result


def get_merge_history() -> list:
    """Get entity merge history for audit."""
    history = []
    if MERGE_HISTORY_PATH.exists():
        with open(MERGE_HISTORY_PATH) as f:
            for line in f:
                try:
                    history.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    return history


def query_entity(G: nx.MultiDiGraph, entity: str) -> dict:
    """Get information about an entity."""
    if entity not in G:
        # Try case-insensitive match
        for node in G.nodes():
            if node.lower() == entity.lower():
                entity = node
                break
        else:
            return {"error": f"Entity '{entity}' not found"}
    
    node_data = dict(G.nodes[entity])
    
    # Get outgoing relationships
    outgoing = []
    for _, target, data in G.out_edges(entity, data=True):
        outgoing.append({
            "target": target,
            "relationship": data.get("type", "related_to"),
            "content": data.get("content", "")[:100]
        })
    
    # Get incoming relationships
    incoming = []
    for source, _, data in G.in_edges(entity, data=True):
        incoming.append({
            "source": source,
            "relationship": data.get("type", "related_to"),
            "content": data.get("content", "")[:100]
        })
    
    return {
        "entity": entity,
        "attributes": node_data,
        "outgoing": outgoing,
        "incoming": incoming
    }


def traverse(G: nx.MultiDiGraph, start: str, hops: int = 2) -> dict:
    """Multi-hop traversal from starting entity."""
    if start not in G:
        for node in G.nodes():
            if node.lower() == start.lower():
                start = node
                break
        else:
            return {"error": f"Entity '{start}' not found"}
    
    # BFS traversal
    visited = {start: 0}
    queue = [(start, 0)]
    edges_found = []
    
    while queue:
        current, depth = queue.pop(0)
        if depth >= hops:
            continue
        
        # Outgoing edges
        for _, target, data in G.out_edges(current, data=True):
            edges_found.append({
                "from": current,
                "to": target,
                "type": data.get("type", "related"),
                "depth": depth + 1
            })
            if target not in visited:
                visited[target] = depth + 1
                queue.append((target, depth + 1))
        
        # Incoming edges
        for source, _, data in G.in_edges(current, data=True):
            edges_found.append({
                "from": source,
                "to": current,
                "type": data.get("type", "related"),
                "depth": depth + 1
            })
            if source not in visited:
                visited[source] = depth + 1
                queue.append((source, depth + 1))
    
    return {
        "start": start,
        "hops": hops,
        "nodes_found": list(visited.keys()),
        "edges": edges_found
    }


def find_related(G: nx.MultiDiGraph, entity: str) -> list[dict]:
    """Find entities related to given entity."""
    result = traverse(G, entity, hops=1)
    if "error" in result:
        return [result]
    
    related = []
    for node in result["nodes_found"]:
        if node != entity:
            node_data = dict(G.nodes[node])
            related.append({
                "entity": node,
                "type": node_data.get("type", "unknown"),
                "mentions": node_data.get("mentions", 0)
            })
    
    return sorted(related, key=lambda x: x["mentions"], reverse=True)


def spreading_activation(
    G: nx.MultiDiGraph,
    seed_nodes: list[str],
    initial_activation: float = 1.0,
    decay: float = 0.5,
    threshold: float = 0.05,
    max_iterations: int = 10,
    lateral_inhibition: float = 0.1
) -> dict[str, float]:
    """
    Spreading activation over knowledge graph.
    
    Based on SYNAPSE paper (arXiv:2601.02744) - SOTA on LoCoMo.
    Activation propagates through edges, decays per hop, accumulates from paths.
    Lateral inhibition reduces noise from highly-connected nodes.
    
    Args:
        G: Knowledge graph
        seed_nodes: Starting entities with initial activation
        initial_activation: Starting activation value for seeds
        decay: Activation decay factor per hop (0-1)
        threshold: Minimum activation to continue spreading
        max_iterations: Maximum propagation iterations
        lateral_inhibition: Penalty for high-degree nodes (reduces hub noise)
        
    Returns:
        Dict of node -> final_activation_score
    """
    # Normalize seed nodes (case-insensitive lookup)
    normalized_seeds = []
    for seed in seed_nodes:
        found = False
        for node in G.nodes():
            if node.lower() == seed.lower():
                normalized_seeds.append(node)
                found = True
                break
        if not found:
            # Try partial match
            for node in G.nodes():
                if seed.lower() in node.lower():
                    normalized_seeds.append(node)
                    found = True
                    break
    
    if not normalized_seeds:
        return {}
    
    # Initialize activation
    activation = {node: 0.0 for node in G.nodes()}
    for seed in normalized_seeds:
        activation[seed] = initial_activation
    
    # Pre-compute node degrees for lateral inhibition
    degrees = {node: G.degree(node) for node in G.nodes()}
    max_degree = max(degrees.values()) if degrees else 1
    
    # Iterative spreading
    for iteration in range(max_iterations):
        new_activation = activation.copy()
        changed = False
        
        for node in G.nodes():
            if activation[node] < threshold:
                continue
            
            # Spread to neighbors (both directions in digraph)
            neighbors = set()
            for _, target, _ in G.out_edges(node, data=True):
                neighbors.add(target)
            for source, _, _ in G.in_edges(node, data=True):
                neighbors.add(source)
            
            for neighbor in neighbors:
                if neighbor == node:
                    continue
                
                # Calculate activation to spread
                spread = activation[node] * decay
                
                # Apply lateral inhibition (penalize hubs)
                degree_penalty = 1.0 - (lateral_inhibition * degrees[neighbor] / max_degree)
                spread *= max(0.1, degree_penalty)
                
                # Accumulate (multiple paths can activate same node)
                if spread > threshold:
                    new_activation[neighbor] += spread
                    changed = True
        
        # Normalize to prevent explosion
        max_act = max(new_activation.values()) if new_activation else 1
        if max_act > 1.0:
            new_activation = {k: v/max_act for k, v in new_activation.items()}
        
        activation = new_activation
        
        if not changed:
            break
    
    # Filter out below-threshold nodes
    result = {k: round(v, 4) for k, v in activation.items() if v >= threshold}
    
    # Sort by activation score
    result = dict(sorted(result.items(), key=lambda x: x[1], reverse=True))
    
    return result


def get_activated_events(
    G: nx.MultiDiGraph,
    activations: dict[str, float]
) -> list[dict]:
    """
    Get events connected to activated nodes.
    Returns events with their activation scores.
    """
    events = []
    seen_events = set()
    
    for node, activation_score in activations.items():
        # Get edges from this node
        for _, target, data in G.out_edges(node, data=True):
            event_id = data.get("event_id", "")
            if event_id and event_id not in seen_events:
                seen_events.add(event_id)
                events.append({
                    "event_id": event_id,
                    "activation": activation_score,
                    "via_node": node,
                    "relationship": data.get("type", "related"),
                    "content": data.get("content", "")[:100]
                })
        
        for source, _, data in G.in_edges(node, data=True):
            event_id = data.get("event_id", "")
            if event_id and event_id not in seen_events:
                seen_events.add(event_id)
                events.append({
                    "event_id": event_id,
                    "activation": activation_score,
                    "via_node": node,
                    "relationship": data.get("type", "related"),
                    "content": data.get("content", "")[:100]
                })
    
    # Sort by activation
    events.sort(key=lambda x: x["activation"], reverse=True)
    return events


def main():
    parser = argparse.ArgumentParser(description="Knowledge graph operations")
    parser.add_argument("--rebuild", action="store_true", help="Rebuild graph from ledger")
    parser.add_argument("--query", help="Query entity information")
    parser.add_argument("--traverse", help="Multi-hop traversal from entity")
    parser.add_argument("--hops", type=int, default=2, help="Number of hops for traversal")
    parser.add_argument("--related", help="Find related entities")
    parser.add_argument("--activate", nargs="+", help="Spreading activation from seed nodes")
    parser.add_argument("--decay", type=float, default=0.5, help="Activation decay per hop")
    parser.add_argument("--stats", action="store_true", help="Show graph statistics")
    
    args = parser.parse_args()
    
    if args.rebuild:
        events = load_ledger()
        print(f"Building graph from {len(events)} events...", file=sys.stderr)
        G = build_graph(events)
        save_graph(G)
        
        # Print stats
        print(f"\nGraph Statistics:")
        print(f"  Nodes: {G.number_of_nodes()}")
        print(f"  Edges: {G.number_of_edges()}")
        print(f"\nTop entities by mentions:")
        nodes_by_mentions = sorted(
            [(n, d.get("mentions", 0)) for n, d in G.nodes(data=True)],
            key=lambda x: x[1],
            reverse=True
        )[:10]
        for name, mentions in nodes_by_mentions:
            print(f"  {name}: {mentions}")
        return
    
    # Load existing graph for queries
    G = load_graph()
    if G is None:
        print("No graph found. Run --rebuild first.", file=sys.stderr)
        sys.exit(1)
    
    if args.stats:
        print(f"Nodes: {G.number_of_nodes()}")
        print(f"Edges: {G.number_of_edges()}")
        return
    
    if args.query:
        result = query_entity(G, args.query)
        print(json.dumps(result, indent=2))
    
    elif args.traverse:
        result = traverse(G, args.traverse, args.hops)
        print(json.dumps(result, indent=2))
    
    elif args.related:
        result = find_related(G, args.related)
        print(json.dumps(result, indent=2))
    
    elif args.activate:
        activations = spreading_activation(G, args.activate, decay=args.decay)
        print(f"Spreading activation from: {args.activate}")
        print(f"Activated {len(activations)} nodes:\n")
        for node, score in list(activations.items())[:20]:
            node_type = G.nodes[node].get("type", "unknown")
            print(f"  [{score:.3f}] {node} ({node_type})")
        
        # Also show connected events
        events = get_activated_events(G, activations)
        if events:
            print(f"\nConnected events ({len(events)}):")
            for e in events[:10]:
                print(f"  [{e['activation']:.3f}] via {e['via_node']}: {e['content'][:60]}...")
    
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
