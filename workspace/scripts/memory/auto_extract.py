#!/usr/bin/env python3
"""
Auto-Extract: Periodically extract facts from recent sessions.
Runs via cron, processes sessions not yet extracted.

Usage:
    python auto_extract.py              # Process unprocessed sessions
    python auto_extract.py --force      # Reprocess all recent sessions
    python auto_extract.py --hours 2    # Look back N hours (default 1)
"""

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime, timedelta
from pathlib import Path

# Paths
OPENCLAW_DIR = Path.home() / ".openclaw"
SESSIONS_DIR = OPENCLAW_DIR / "agents" / "main" / "sessions"
WORKSPACE = Path(os.environ.get("CLAWD_WORKSPACE", Path.home() / "clawd"))
MEMORY_DIR = WORKSPACE / "memory"
PROCESSED_LOG = MEMORY_DIR / "extracted" / "processed_sessions.json"
EXTRACT_SCRIPT = WORKSPACE / "scripts" / "memory" / "extract_facts.py"

# Ensure directories exist
(MEMORY_DIR / "extracted").mkdir(parents=True, exist_ok=True)


def load_processed() -> dict:
    """Load set of already-processed session IDs."""
    if PROCESSED_LOG.exists():
        try:
            return json.loads(PROCESSED_LOG.read_text())
        except json.JSONDecodeError:
            return {"sessions": {}}
    return {"sessions": {}}


def save_processed(data: dict):
    """Save processed sessions log."""
    with open(PROCESSED_LOG, "w") as f:
        json.dump(data, f, indent=2)


def get_recent_sessions(hours: int = 1) -> list[Path]:
    """Find session files modified in the last N hours."""
    if not SESSIONS_DIR.exists():
        print(f"Sessions directory not found: {SESSIONS_DIR}", file=sys.stderr)
        return []
    
    cutoff = datetime.now() - timedelta(hours=hours)
    recent = []
    
    for session_file in SESSIONS_DIR.glob("*.jsonl"):
        mtime = datetime.fromtimestamp(session_file.stat().st_mtime)
        if mtime > cutoff:
            recent.append(session_file)
    
    return sorted(recent, key=lambda p: p.stat().st_mtime, reverse=True)


def should_process(session_file: Path, processed: dict, force: bool = False) -> bool:
    """Check if session should be processed."""
    session_id = session_file.stem
    
    if force:
        return True
    
    # Skip if already processed with same mtime
    if session_id in processed.get("sessions", {}):
        last_mtime = processed["sessions"][session_id].get("mtime", 0)
        current_mtime = session_file.stat().st_mtime
        if current_mtime <= last_mtime:
            return False
    
    return True


def extract_from_session(session_file: Path) -> tuple[bool, int]:
    """Run extraction on a session file. Returns (success, fact_count)."""
    try:
        result = subprocess.run(
            ["python3", str(EXTRACT_SCRIPT), "--session", str(session_file)],
            capture_output=True,
            text=True,
            timeout=120
        )
        
        if result.returncode != 0:
            print(f"  Error: {result.stderr[:200]}", file=sys.stderr)
            return False, 0
        
        # Count extracted facts from output
        try:
            facts = json.loads(result.stdout)
            return True, len(facts)
        except json.JSONDecodeError:
            return True, 0
            
    except subprocess.TimeoutExpired:
        print(f"  Timeout extracting from {session_file.name}", file=sys.stderr)
        return False, 0
    except Exception as e:
        print(f"  Exception: {e}", file=sys.stderr)
        return False, 0


def main():
    parser = argparse.ArgumentParser(description="Auto-extract facts from sessions")
    parser.add_argument("--force", action="store_true", help="Reprocess all sessions")
    parser.add_argument("--hours", type=int, default=1, help="Hours to look back")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be processed")
    
    args = parser.parse_args()
    
    # Load processed log
    processed = load_processed()
    
    # Find recent sessions
    recent = get_recent_sessions(args.hours)
    print(f"Found {len(recent)} sessions in last {args.hours} hour(s)", file=sys.stderr)
    
    # Filter to unprocessed
    to_process = [s for s in recent if should_process(s, processed, args.force)]
    print(f"{len(to_process)} sessions need processing", file=sys.stderr)
    
    if args.dry_run:
        for session in to_process:
            print(f"  Would process: {session.name}")
        return
    
    # Process each session
    total_facts = 0
    for session in to_process:
        print(f"Processing {session.name}...", file=sys.stderr)
        success, fact_count = extract_from_session(session)
        
        if success:
            # Mark as processed
            processed.setdefault("sessions", {})[session.stem] = {
                "mtime": session.stat().st_mtime,
                "processed_at": datetime.now().isoformat(),
                "facts_extracted": fact_count
            }
            total_facts += fact_count
            print(f"  Extracted {fact_count} facts", file=sys.stderr)
    
    # Save updated log
    save_processed(processed)
    
    print(f"\nTotal: {total_facts} facts extracted from {len(to_process)} sessions", file=sys.stderr)
    
    # Rebuild embedding index if we extracted anything
    if total_facts > 0:
        print("Rebuilding embedding index...", file=sys.stderr)
        embed_script = WORKSPACE / "scripts" / "memory" / "embed_memories.py"
        subprocess.run(
            ["python3", str(embed_script), "--rebuild"],
            capture_output=True,
            timeout=180
        )
        print("Index rebuilt", file=sys.stderr)


if __name__ == "__main__":
    main()
