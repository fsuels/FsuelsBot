#!/usr/bin/env python3
"""
Semantic Memory Search for OpenClaw
Replaces basic text matching with embedding-based retrieval.

Usage:
    python semantic_search.py "what did we decide about pricing"
    python semantic_search.py --json "query" 
    python semantic_search.py --time "last week" "query"
    
Designed to be called by memory_search tool or directly.
"""

import argparse
import json
import re
import sys
from datetime import datetime, timedelta
from pathlib import Path

# Import embedding module
sys.path.insert(0, str(Path(__file__).parent))
from embed_memories import search, load_index

# Temporal index path
WORKSPACE = Path.home() / "clawd"
TEMPORAL_INDEX_PATH = WORKSPACE / "memory" / "temporal_index.json"


def parse_time_hint(query: str) -> tuple:
    """
    Parse natural language time hints from query.
    Returns (start_date, end_date, cleaned_query) or (None, None, query).
    """
    today = datetime.now().date()
    
    patterns = [
        (r'\b(today)\b', lambda: (today, today)),
        (r'\b(yesterday)\b', lambda: (today - timedelta(days=1), today - timedelta(days=1))),
        (r'\b(this week)\b', lambda: (today - timedelta(days=today.weekday()), today)),
        (r'\b(last week)\b', lambda: (today - timedelta(days=today.weekday() + 7), today - timedelta(days=today.weekday() + 1))),
        (r'\b(this month)\b', lambda: (today.replace(day=1), today)),
        (r'\b(last month)\b', lambda: ((today.replace(day=1) - timedelta(days=1)).replace(day=1), today.replace(day=1) - timedelta(days=1))),
        (r'\b(\d+)\s+days?\s+ago\b', lambda m: (today - timedelta(days=int(m.group(1))), today - timedelta(days=int(m.group(1))))),
        (r'\b(past|last)\s+(\d+)\s+days?\b', lambda m: (today - timedelta(days=int(m.group(2))), today)),
    ]
    
    for pattern, date_fn in patterns:
        match = re.search(pattern, query, re.IGNORECASE)
        if match:
            try:
                if callable(date_fn):
                    dates = date_fn(match) if match.groups() else date_fn()
                else:
                    dates = date_fn
                start, end = dates
                # Remove time hint from query
                cleaned = re.sub(pattern, '', query, flags=re.IGNORECASE).strip()
                return start, end, cleaned
            except Exception:
                continue
    
    return None, None, query


def filter_by_time(results: list, start_date, end_date) -> list:
    """Filter results by time range."""
    filtered = []
    for r in results:
        ts_str = r.get("ts", "")
        if not ts_str:
            continue
        
        try:
            # Parse timestamp
            ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
            event_date = ts.date()
            
            if start_date <= event_date <= end_date:
                filtered.append(r)
        except (ValueError, TypeError):
            # Include results with unparseable timestamps
            continue
    
    return filtered


def format_results(results: list[dict], format_type: str = "text") -> str:
    """Format search results for display."""
    if not results:
        return "No results found."
    
    if format_type == "json":
        return json.dumps(results, indent=2)
    
    # Text format for human reading
    lines = []
    for i, r in enumerate(results, 1):
        score = r.get("score", 0)
        content = r.get("content", "")[:200]
        source = r.get("source", "unknown")
        entry_type = r.get("type", "fact")
        priority = r.get("priority", "P2")
        
        lines.append(f"{i}. [{score:.2f}] [{priority}] ({entry_type})")
        lines.append(f"   {content}")
        lines.append(f"   Source: {source}")
        lines.append("")
    
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="Semantic memory search")
    parser.add_argument("query", nargs="?", help="Search query")
    parser.add_argument("--json", action="store_true", help="Output as JSON")
    parser.add_argument("--top-k", type=int, default=5, help="Number of results")
    parser.add_argument("--min-score", type=float, default=0.3, help="Minimum similarity score")
    parser.add_argument("--time", action="store_true", help="Parse time hints from query (e.g., 'last week')")
    
    args = parser.parse_args()
    
    if not args.query:
        # Read from stdin if no query provided
        args.query = sys.stdin.read().strip()
    
    if not args.query:
        parser.print_help()
        sys.exit(1)
    
    # Check if index exists
    index, _ = load_index()
    if index is None:
        print("Error: No embedding index found.", file=sys.stderr)
        print("Run: python embed_memories.py --rebuild", file=sys.stderr)
        sys.exit(1)
    
    # Parse time hints
    query = args.query
    start_date, end_date = None, None
    if args.time:
        start_date, end_date, query = parse_time_hint(args.query)
        if start_date:
            print(f"Time filter: {start_date} to {end_date}", file=sys.stderr)
    
    # Search (fetch more if time filtering)
    fetch_count = args.top_k * 5 if start_date else args.top_k
    results = search(query, fetch_count)
    
    # Filter by minimum score
    results = [r for r in results if r.get("score", 0) >= args.min_score]
    
    # Apply time filter
    if start_date:
        results = filter_by_time(results, start_date, end_date)
    
    results = results[:args.top_k]
    
    # Format and output
    output = format_results(results, "json" if args.json else "text")
    print(output)


if __name__ == "__main__":
    main()
