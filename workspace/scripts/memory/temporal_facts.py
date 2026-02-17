#!/usr/bin/env python3
"""
Temporal Fact Tracking for OpenClaw Memory System
Based on Zep's temporal knowledge graph approach.

Tracks when facts become valid/invalid, enabling:
- "When did GMC get suspended?" 
- "What changed about Google Ads between Jan 26-28?"
- "What was the state of X at time Y?"

Usage:
    python temporal_facts.py --rebuild           # Build temporal index
    python temporal_facts.py --history "GMC"     # Show entity history
    python temporal_facts.py --at "2026-01-27" "Google Ads"  # State at time
    python temporal_facts.py --changes --since "2026-01-26"  # Recent changes
"""

import argparse
import json
import os
import re
import sys
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional
from collections import defaultdict

# Paths
WORKSPACE = Path(os.environ.get("CLAWD_WORKSPACE", Path.home() / "clawd"))
MEMORY_DIR = WORKSPACE / "memory"
LEDGER_PATH = MEMORY_DIR / "ledger.jsonl"
TEMPORAL_INDEX_PATH = MEMORY_DIR / "temporal_index.json"

# State transition keywords
STATE_KEYWORDS = {
    "created": ["created", "started", "launched", "began", "initialized"],
    "updated": ["updated", "changed", "modified", "edited", "revised"],
    "fixed": ["fixed", "resolved", "completed", "done", "repaired"],
    "broken": ["broken", "failed", "error", "issue", "problem", "suspended", "blocked"],
    "pending": ["pending", "waiting", "in progress", "ongoing"],
}


def parse_timestamp(ts_str: str) -> Optional[datetime]:
    """Parse ISO timestamp string."""
    if not ts_str:
        return None
    try:
        # Handle various formats
        ts_str = ts_str.replace("Z", "+00:00")
        return datetime.fromisoformat(ts_str)
    except ValueError:
        return None


def extract_entity_mentions(text: str) -> list[str]:
    """Extract entity mentions from text."""
    patterns = [
        r"\b(DLM|Dress Like Mommy)\b",
        r"\b(GMC|Google Merchant Center)\b",
        r"\b(Google Ads)\b",
        r"\b(Microsoft Ads)\b",
        r"\b(BuckyDrop)\b",
        r"\b(Shopify)\b",
        r"\b(TikTok)\b",
        r"\b(Pinterest)\b",
        r"\b(Facebook)\b",
        r"\b(Francisco)\b",
        r"\b(FsuelsBot|McSuels)\b",
    ]
    
    entities = []
    for pattern in patterns:
        matches = re.findall(pattern, text, re.IGNORECASE)
        entities.extend(matches)
    
    # Normalize
    normalized = []
    for e in entities:
        if e.lower() in ("dlm", "dress like mommy"):
            normalized.append("DLM")
        elif e.lower() in ("gmc", "google merchant center"):
            normalized.append("GMC")
        elif e.lower() in ("fsuelsbot", "mcsuels"):
            normalized.append("FsuelsBot")
        else:
            normalized.append(e)
    
    return list(set(normalized))


def infer_state(content: str) -> Optional[str]:
    """Infer state from content keywords."""
    content_lower = content.lower()
    for state, keywords in STATE_KEYWORDS.items():
        for keyword in keywords:
            if keyword in content_lower:
                return state
    return None


def build_temporal_index(events: list[dict]) -> dict:
    """Build temporal index from events."""
    # Structure: entity -> [{timestamp, state, content, event_id}, ...]
    timeline = defaultdict(list)
    
    for event in events:
        ts = event.get("ts", "")
        timestamp = parse_timestamp(ts)
        if not timestamp:
            continue
        
        content = event.get("content", "")
        event_id = event.get("id", "")
        event_type = event.get("type", "fact")
        
        # Get entity from event or extract from content
        explicit_entity = event.get("entity")
        mentioned_entities = extract_entity_mentions(content)
        
        all_entities = mentioned_entities
        if explicit_entity and explicit_entity not in all_entities:
            all_entities.append(explicit_entity)
        
        # Infer state
        state = infer_state(content)
        if not state:
            state = "updated"  # Default
        
        # Add to timeline for each entity
        for entity in all_entities:
            timeline[entity].append({
                "timestamp": timestamp.isoformat(),
                "state": state,
                "event_type": event_type,
                "event_id": event_id,
                "content": content[:300]
            })
    
    # Sort each entity's timeline
    for entity in timeline:
        timeline[entity].sort(key=lambda x: x["timestamp"])
    
    return dict(timeline)


def save_temporal_index(index: dict):
    """Save temporal index to file."""
    with open(TEMPORAL_INDEX_PATH, "w") as f:
        json.dump(index, f, indent=2)
    print(f"Saved temporal index: {len(index)} entities tracked", file=sys.stderr)


def load_temporal_index() -> Optional[dict]:
    """Load temporal index from file."""
    if not TEMPORAL_INDEX_PATH.exists():
        return None
    with open(TEMPORAL_INDEX_PATH) as f:
        return json.load(f)


def get_entity_history(index: dict, entity: str) -> list[dict]:
    """Get full history for an entity."""
    # Case-insensitive lookup
    for key in index:
        if key.lower() == entity.lower():
            return index[key]
    return []


def get_state_at_time(index: dict, entity: str, at_time: datetime) -> Optional[dict]:
    """Get entity state at a specific time."""
    history = get_entity_history(index, entity)
    if not history:
        return None
    
    # Find most recent event before at_time
    state = None
    for event in history:
        event_time = parse_timestamp(event["timestamp"])
        if event_time and event_time <= at_time:
            state = event
        else:
            break
    
    return state


def get_changes_since(index: dict, since: datetime) -> list[dict]:
    """Get all changes since a given time."""
    changes = []
    
    for entity, history in index.items():
        for event in history:
            event_time = parse_timestamp(event["timestamp"])
            if event_time and event_time >= since:
                changes.append({
                    "entity": entity,
                    **event
                })
    
    # Sort by timestamp
    changes.sort(key=lambda x: x["timestamp"])
    return changes


def main():
    parser = argparse.ArgumentParser(description="Temporal fact tracking")
    parser.add_argument("--rebuild", action="store_true", help="Rebuild temporal index")
    parser.add_argument("--history", help="Show entity history")
    parser.add_argument("--at", help="Get state at time (YYYY-MM-DD)")
    parser.add_argument("--changes", action="store_true", help="Show changes")
    parser.add_argument("--since", help="Changes since date (YYYY-MM-DD)")
    parser.add_argument("entity", nargs="?", help="Entity name for --at query")
    
    args = parser.parse_args()
    
    if args.rebuild:
        # Load ledger
        events = []
        if LEDGER_PATH.exists():
            with open(LEDGER_PATH, encoding='utf-8', errors='replace') as f:
                for line in f:
                    try:
                        events.append(json.loads(line))
                    except json.JSONDecodeError:
                        continue
        
        print(f"Building temporal index from {len(events)} events...", file=sys.stderr)
        index = build_temporal_index(events)
        save_temporal_index(index)
        
        # Show stats
        print(f"\nEntities tracked: {len(index)}")
        print("\nEntities with most history:")
        by_history = sorted(index.items(), key=lambda x: len(x[1]), reverse=True)[:10]
        for entity, history in by_history:
            print(f"  {entity}: {len(history)} events")
        return
    
    # Load index for queries
    index = load_temporal_index()
    if not index:
        print("No temporal index found. Run --rebuild first.", file=sys.stderr)
        sys.exit(1)
    
    if args.history:
        history = get_entity_history(index, args.history)
        if not history:
            print(f"No history found for '{args.history}'")
        else:
            print(f"History for {args.history}:")
            for event in history:
                ts = event["timestamp"][:10]
                state = event["state"]
                content = event["content"][:80]
                print(f"  [{ts}] {state}: {content}...")
    
    elif args.at and args.entity:
        at_time = datetime.fromisoformat(args.at)
        state = get_state_at_time(index, args.entity, at_time)
        if state:
            print(json.dumps(state, indent=2))
        else:
            print(f"No state found for '{args.entity}' at {args.at}")
    
    elif args.changes:
        since = datetime.fromisoformat(args.since) if args.since else datetime.now() - timedelta(days=7)
        changes = get_changes_since(index, since)
        print(f"Changes since {since.date()}:")
        for change in changes:
            ts = change["timestamp"][:10]
            entity = change["entity"]
            state = change["state"]
            content = change["content"][:60]
            print(f"  [{ts}] {entity} -> {state}: {content}...")
    
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
