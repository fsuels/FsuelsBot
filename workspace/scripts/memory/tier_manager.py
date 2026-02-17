#!/usr/bin/env python3
"""
Hybrid Tier Manager for OpenClaw Memory
Based on Arena Round 2: Hot/Warm/Cold architecture.

- HOT: Context-stuffed into pack.md (always in session context)
- WARM: RAG retrieval (semantic search when needed)
- COLD: Archived (rarely accessed, preserved for audit)

Usage:
    python tier_manager.py --classify     # Classify all entries by tier
    python tier_manager.py --promote      # Promote hot items to pack.md
    python tier_manager.py --demote       # Move cold items to archive
    python tier_manager.py --stats        # Show tier distribution
"""

import argparse
import json
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Dict, Tuple

# Paths
WORKSPACE = Path(os.environ.get("CLAWD_WORKSPACE", Path.home() / "clawd"))
MEMORY_DIR = WORKSPACE / "memory"
LEDGER_PATH = MEMORY_DIR / "ledger.jsonl"
PACK_PATH = WORKSPACE / "recall" / "pack.md"
ARCHIVE_DIR = MEMORY_DIR / "archive"

# Ensure directories
ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)

# Tier thresholds
HOT_RECENCY_DAYS = 7       # Items from last 7 days considered for hot
HOT_MIN_PRIORITY = "P1"    # P0 and P1 can be hot
COLD_RECENCY_DAYS = 90     # Items older than 90 days considered for cold
COLD_DECAY_THRESHOLD = 0.1 # Low decay score → cold


def load_ledger() -> List[dict]:
    """Load all ledger events."""
    events = []
    if LEDGER_PATH.exists():
        with open(LEDGER_PATH, encoding='utf-8', errors='replace') as f:
            for line in f:
                try:
                    events.append(json.loads(line.strip()))
                except json.JSONDecodeError:
                    continue
    return events


def parse_timestamp(ts: str) -> datetime:
    """Parse ISO timestamp to naive datetime."""
    try:
        dt = datetime.fromisoformat(ts.replace('Z', '+00:00'))
        # Convert to naive by removing timezone
        if dt.tzinfo is not None:
            dt = dt.replace(tzinfo=None)
        return dt
    except:
        return datetime.now()


def calculate_decay_score(event: dict, now: datetime) -> float:
    """Calculate time-based decay score (0-1)."""
    ts = parse_timestamp(event.get("ts", ""))
    age_days = (now - ts).days
    
    # Exponential decay with half-life of 30 days
    half_life = 30
    decay = 0.5 ** (age_days / half_life)
    
    # Priority boost
    priority = event.get("priority", "P2")
    boost = {"P0": 2.0, "P1": 1.5, "P2": 1.0, "P3": 0.5}.get(priority, 1.0)
    
    return min(decay * boost, 1.0)


def classify_tier(event: dict, now: datetime) -> str:
    """Determine the appropriate tier for an event."""
    ts = parse_timestamp(event.get("ts", ""))
    age_days = (now - ts).days
    priority = event.get("priority", "P2")
    event_type = event.get("type", "fact")
    decay = calculate_decay_score(event, now)
    
    # HOT criteria:
    # - P0 always hot (critical)
    # - P1 within 7 days
    # - Decisions and constraints are sticky (hot longer)
    if priority == "P0":
        return "hot"
    if priority == "P1" and age_days <= HOT_RECENCY_DAYS:
        return "hot"
    if event_type in ("decision", "constraint", "commitment") and age_days <= 30:
        return "hot"
    
    # COLD criteria:
    # - Old + low decay
    # - P3 older than 30 days
    if age_days > COLD_RECENCY_DAYS and decay < COLD_DECAY_THRESHOLD:
        return "cold"
    if priority == "P3" and age_days > 30:
        return "cold"
    
    # Default: WARM
    return "warm"


def classify_all() -> Dict[str, List[dict]]:
    """Classify all ledger entries by tier."""
    events = load_ledger()
    now = datetime.now()
    
    tiers = {"hot": [], "warm": [], "cold": []}
    
    for event in events:
        tier = classify_tier(event, now)
        event["_computed_tier"] = tier
        tiers[tier].append(event)
    
    return tiers


def get_tier_stats() -> dict:
    """Get tier distribution stats."""
    tiers = classify_all()
    total = sum(len(v) for v in tiers.values())
    
    return {
        "total": total,
        "hot": len(tiers["hot"]),
        "warm": len(tiers["warm"]),
        "cold": len(tiers["cold"]),
        "hot_pct": round(100 * len(tiers["hot"]) / total, 1) if total else 0,
        "warm_pct": round(100 * len(tiers["warm"]) / total, 1) if total else 0,
        "cold_pct": round(100 * len(tiers["cold"]) / total, 1) if total else 0,
    }


def promote_hot_to_pack(dry_run: bool = True) -> dict:
    """
    Add hot tier items to pack.md for context stuffing.
    Returns summary of what was/would be added.
    """
    tiers = classify_all()
    hot_items = tiers["hot"]
    
    result = {
        "hot_count": len(hot_items),
        "items": [],
        "dry_run": dry_run
    }
    
    if not hot_items:
        return result
    
    # Group by type for organized output
    by_type = {}
    for item in hot_items:
        t = item.get("type", "fact")
        by_type.setdefault(t, []).append(item)
    
    # Build pack content
    lines = [
        "# Hot Memory Tier",
        f"_Auto-generated: {datetime.now().strftime('%Y-%m-%d %H:%M')}_",
        f"_Items: {len(hot_items)}_",
        ""
    ]
    
    for event_type, items in sorted(by_type.items()):
        lines.append(f"## {event_type.title()}s")
        for item in sorted(items, key=lambda x: x.get("priority", "P2")):
            priority = item.get("priority", "P2")
            content = item.get("content", "")[:200]
            lines.append(f"- [{priority}] {content}")
            result["items"].append({
                "id": item.get("id"),
                "type": event_type,
                "priority": priority,
                "content": content[:50] + "..."
            })
        lines.append("")
    
    if not dry_run:
        # Append to pack.md (or create hot section)
        hot_section = "\n".join(lines)
        
        if PACK_PATH.exists():
            current = PACK_PATH.read_text()
            # Remove old hot section if exists
            if "# Hot Memory Tier" in current:
                parts = current.split("# Hot Memory Tier")
                # Find end of hot section (next ## or end)
                current = parts[0].rstrip() + "\n\n"
        else:
            current = ""
        
        PACK_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(PACK_PATH, "w") as f:
            f.write(current + hot_section)
    
    return result


def demote_cold_to_archive(dry_run: bool = True) -> dict:
    """
    Move cold tier items to archive.
    Returns summary of what was/would be archived.
    """
    tiers = classify_all()
    cold_items = tiers["cold"]
    
    result = {
        "cold_count": len(cold_items),
        "archived": [],
        "dry_run": dry_run
    }
    
    if not cold_items or dry_run:
        result["archived"] = [{"id": i.get("id"), "content": i.get("content", "")[:50]} for i in cold_items[:10]]
        return result
    
    # Archive cold items
    archive_file = ARCHIVE_DIR / f"cold_{datetime.now().strftime('%Y%m%d')}.jsonl"
    cold_ids = set()
    
    with open(archive_file, "a") as f:
        for item in cold_items:
            item["archived_at"] = datetime.now().isoformat()
            f.write(json.dumps(item) + "\n")
            cold_ids.add(item.get("id"))
            result["archived"].append({"id": item.get("id")})
    
    # Remove from ledger (rewrite without cold items)
    all_events = load_ledger()
    remaining = [e for e in all_events if e.get("id") not in cold_ids]
    
    tmp = LEDGER_PATH.with_suffix(".tmp")
    with open(tmp, "w") as f:
        for event in remaining:
            f.write(json.dumps(event) + "\n")
    tmp.rename(LEDGER_PATH)
    
    return result


def main():
    parser = argparse.ArgumentParser(description="Hybrid Tier Manager")
    parser.add_argument("--classify", action="store_true", help="Classify all entries")
    parser.add_argument("--stats", action="store_true", help="Show tier statistics")
    parser.add_argument("--promote", action="store_true", help="Promote hot items to pack.md")
    parser.add_argument("--demote", action="store_true", help="Demote cold items to archive")
    parser.add_argument("--execute", action="store_true", help="Actually execute (not dry run)")
    args = parser.parse_args()
    
    if args.stats:
        stats = get_tier_stats()
        print(json.dumps(stats, indent=2))
    
    elif args.classify:
        tiers = classify_all()
        print(f"Hot:  {len(tiers['hot'])} items")
        print(f"Warm: {len(tiers['warm'])} items")
        print(f"Cold: {len(tiers['cold'])} items")
        print("\nSample hot items:")
        for item in tiers["hot"][:5]:
            print(f"  [{item.get('priority')}] {item.get('content', '')[:60]}...")
    
    elif args.promote:
        result = promote_hot_to_pack(dry_run=not args.execute)
        print(json.dumps(result, indent=2))
    
    elif args.demote:
        result = demote_cold_to_archive(dry_run=not args.execute)
        print(json.dumps(result, indent=2))
    
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
