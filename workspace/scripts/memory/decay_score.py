#!/usr/bin/env python3
"""
Memory Decay Scoring for OpenClaw
Implements Ebbinghaus-inspired forgetting curve.

Decay formula: score = base_importance * recency_factor * access_boost

Where:
- base_importance: P0=1.0, P1=0.7, P2=0.4
- recency_factor: e^(-λ * days_old), λ = decay rate
- access_boost: 1 + log(1 + access_count)

Usage:
    python decay_score.py --score-all           # Score all memories
    python decay_score.py --prune --threshold 0.1  # Remove low-scoring
    python decay_score.py --top 20              # Show top 20 memories
"""

import argparse
import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

# Paths
WORKSPACE = Path.home() / "clawd"
MEMORY_DIR = WORKSPACE / "memory"
LEDGER_PATH = MEMORY_DIR / "ledger.jsonl"
ACCESS_LOG_PATH = MEMORY_DIR / "access_log.jsonl"

# Decay parameters (tunable)
DECAY_RATE = 0.05  # Higher = faster forgetting
PRIORITY_WEIGHTS = {
    "P0": 1.0,   # Never forget
    "P1": 0.7,
    "P2": 0.4,
    "P3": 0.2
}

# Types that should never decay
IMMORTAL_TYPES = {"constraint", "commitment", "procedure", "decision"}


def load_access_log() -> dict[str, int]:
    """Load access counts from log."""
    access_counts = {}
    if ACCESS_LOG_PATH.exists():
        with open(ACCESS_LOG_PATH, encoding='utf-8', errors='replace') as f:
            for line in f:
                try:
                    entry = json.loads(line)
                    event_id = entry.get("event_id")
                    if event_id:
                        access_counts[event_id] = access_counts.get(event_id, 0) + 1
                except json.JSONDecodeError:
                    continue
    return access_counts


def log_access(event_id: str):
    """Log that a memory was accessed."""
    with open(ACCESS_LOG_PATH, "a") as f:
        entry = {
            "event_id": event_id,
            "ts": datetime.now(timezone.utc).isoformat()
        }
        f.write(json.dumps(entry) + "\n")


def calculate_decay_score(
    event: dict,
    now: datetime,
    access_counts: dict[str, int]
) -> float:
    """Calculate decay score for a memory event.
    
    DISABLED (2026-02-14): Per cross-model consensus (Gemini/GPT-5.2/o3 = 10/10),
    ALL memories are now immortal. Pruning is premature optimization for 110 events.
    Storage is cheap; text is tiny. Will take 5+ years to reach scale that needs pruning.
    
    To re-enable decay in the future, remove the early return below.
    """
    # ============================================================
    # IMMORTAL MEMORY: All events score 1.0 (no decay/pruning)
    # Consensus: Gemini 7.5/10, GPT-5.2 9.8/10, o3 10/10 all agreed
    # ============================================================
    return 1.0
    
    # --- ORIGINAL DECAY LOGIC (preserved for future use) ---
    event_type = event.get("type", "fact")
    priority = event.get("priority", "P2")
    event_id = event.get("id", "")
    
    # Immortal types never decay
    if event_type in IMMORTAL_TYPES:
        return 1.0
    
    # P0 items never decay
    if priority == "P0":
        return 1.0
    
    # Calculate days since event
    ts_str = event.get("ts", "")
    try:
        event_time = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
        if event_time.tzinfo is None:
            event_time = event_time.replace(tzinfo=timezone.utc)
        days_old = (now - event_time).total_seconds() / 86400
    except (ValueError, TypeError):
        days_old = 30  # Default if timestamp invalid
    
    # Base importance from priority
    base_importance = PRIORITY_WEIGHTS.get(priority, 0.4)
    
    # Recency factor (exponential decay)
    recency_factor = math.exp(-DECAY_RATE * days_old)
    
    # Access boost (logarithmic)
    access_count = access_counts.get(event_id, 0)
    access_boost = 1 + math.log(1 + access_count)
    
    # Combined score
    score = base_importance * recency_factor * access_boost
    
    # Clamp to [0, 1]
    return min(1.0, max(0.0, score))


def score_all_memories() -> list[tuple[dict, float]]:
    """Score all memories and return sorted by score."""
    if not LEDGER_PATH.exists():
        return []
    
    now = datetime.now(timezone.utc)
    access_counts = load_access_log()
    
    scored = []
    with open(LEDGER_PATH, encoding='utf-8', errors='replace') as f:
        for line in f:
            try:
                event = json.loads(line)
                score = calculate_decay_score(event, now, access_counts)
                scored.append((event, score))
            except json.JSONDecodeError:
                continue
    
    # Sort by score descending
    scored.sort(key=lambda x: x[1], reverse=True)
    return scored


def prune_memories(threshold: float, dry_run: bool = True) -> list[dict]:
    """Remove memories below threshold. Returns pruned events."""
    scored = score_all_memories()
    
    keep = []
    prune = []
    
    for event, score in scored:
        if score >= threshold:
            keep.append(event)
        else:
            prune.append(event)
    
    if not dry_run and prune:
        # Backup original
        backup_path = LEDGER_PATH.with_suffix(".jsonl.bak")
        import shutil
        shutil.copy(LEDGER_PATH, backup_path)
        
        # Write filtered ledger
        with open(LEDGER_PATH, "w") as f:
            for event in keep:
                f.write(json.dumps(event) + "\n")
        
        print(f"Pruned {len(prune)} memories (backup: {backup_path})", file=sys.stderr)
    
    return prune


def main():
    parser = argparse.ArgumentParser(description="Memory decay scoring")
    parser.add_argument("--score-all", action="store_true", help="Score all memories")
    parser.add_argument("--top", type=int, default=20, help="Show top N memories")
    parser.add_argument("--prune", action="store_true", help="Prune low-scoring memories")
    parser.add_argument("--threshold", type=float, default=0.1, help="Prune threshold")
    parser.add_argument("--dry-run", action="store_true", help="Don't actually prune")
    parser.add_argument("--log-access", help="Log access to event ID")
    
    args = parser.parse_args()
    
    if args.log_access:
        log_access(args.log_access)
        print(f"Logged access to {args.log_access}")
        return
    
    if args.prune:
        pruned = prune_memories(args.threshold, dry_run=args.dry_run)
        print(f"Would prune {len(pruned)} memories below threshold {args.threshold}")
        for event in pruned[:10]:
            print(f"  - {event.get('id')}: {event.get('content', '')[:60]}...")
        return
    
    if args.score_all:
        scored = score_all_memories()
        
        print(f"Total memories: {len(scored)}")
        print(f"\nTop {args.top} by decay score:")
        print("-" * 80)
        
        for event, score in scored[:args.top]:
            content = event.get("content", "")[:50]
            priority = event.get("priority", "P2")
            event_type = event.get("type", "fact")
            print(f"[{score:.3f}] [{priority}] ({event_type}) {content}...")
        
        # Show score distribution
        thresholds = [0.1, 0.3, 0.5, 0.7, 0.9]
        print("\nScore distribution:")
        for t in thresholds:
            count = sum(1 for _, s in scored if s >= t)
            print(f"  >= {t}: {count} memories")


if __name__ == "__main__":
    main()
