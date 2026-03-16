#!/usr/bin/env python3
"""
Cron Idempotency System
Prevents duplicate cron job runs within configured windows.
Council-designed: Grade A+
"""

import json
import os
from pathlib import Path
from datetime import datetime, timezone
from typing import Optional, Dict, Any
from zoneinfo import ZoneInfo

WORKSPACE = Path(r"C:\dev\FsuelsBot\workspace")
CRON_RUNS_DIR = WORKSPACE / "memory" / "cron-runs"
EST = ZoneInfo("America/New_York")

# Default windows per job type
DEFAULT_WINDOWS = {
    "research-brief": "daily",
    "curiosity-engine": "daily",
    "compound-learn": "daily",
    "compound-ship": "daily",
    "github-backup": "hourly",
    "memory-consolidation": "daily",
}

def get_window_key(job_id: str, window_type: str = None) -> str:
    """Get the idempotency window key for a job."""
    if window_type is None:
        window_type = DEFAULT_WINDOWS.get(job_id, "daily")
    
    now = datetime.now(EST)
    
    if window_type == "hourly":
        return now.strftime("%Y-%m-%dT%H")
    elif window_type == "daily":
        return now.strftime("%Y-%m-%d")
    elif window_type == "weekly":
        return now.strftime("%Y-W%W")
    else:  # none
        return str(int(now.timestamp() * 1000))

def get_runs_file() -> Path:
    """Get path to today's runs file."""
    CRON_RUNS_DIR.mkdir(parents=True, exist_ok=True)
    today = datetime.now(EST).strftime("%Y-%m-%d")
    return CRON_RUNS_DIR / f"{today}.jsonl"

def read_runs() -> list:
    """Read all runs from today's file."""
    runs_file = get_runs_file()
    if not runs_file.exists():
        return []
    
    runs = []
    for line in runs_file.read_text(encoding='utf-8').strip().split('\n'):
        if line:
            try:
                runs.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return runs

def find_run(job_id: str, window: str) -> Optional[Dict]:
    """Find existing run for job+window."""
    runs = read_runs()
    for run in runs:
        if run.get("job") == job_id and run.get("window") == window:
            return run
    return None

def check_idempotency(job_id: str, window_type: str = None) -> Dict[str, Any]:
    """
    Check if a cron job should run.
    
    Returns:
        {
            "should_run": bool,
            "reason": str,
            "existing_run": dict or None
        }
    """
    window = get_window_key(job_id, window_type)
    existing = find_run(job_id, window)
    
    if existing is None:
        return {
            "should_run": True,
            "reason": f"No run found for {job_id} in window {window}",
            "existing_run": None
        }
    
    status = existing.get("status")
    
    if status == "completed":
        return {
            "should_run": False,
            "reason": f"Already completed in window {window}",
            "existing_run": existing
        }
    
    if status == "failed":
        return {
            "should_run": True,
            "reason": f"Previous run failed, allowing retry",
            "existing_run": existing
        }
    
    if status == "started":
        # Check if stale (started > 1 hour ago)
        started = existing.get("started_at")
        if started:
            try:
                started_time = datetime.fromisoformat(started)
                age_seconds = (datetime.now(timezone.utc) - started_time.astimezone(timezone.utc)).total_seconds()
                if age_seconds > 3600:  # 1 hour
                    return {
                        "should_run": True,
                        "reason": f"Previous run stale ({age_seconds/60:.0f}min old), allowing retry",
                        "existing_run": existing
                    }
            except:
                pass
        
        return {
            "should_run": False,
            "reason": f"Run already in progress",
            "existing_run": existing
        }
    
    return {
        "should_run": True,
        "reason": f"Unknown status '{status}', allowing run",
        "existing_run": existing
    }

def record_start(job_id: str, trigger: str = "scheduled", force: bool = False) -> str:
    """Record that a cron job is starting. Returns run_id."""
    now = datetime.now(EST)
    window = get_window_key(job_id)
    
    run_id = f"cron-{now.strftime('%Y%m%d-%H%M%S')}-{job_id}"
    
    run = {
        "id": run_id,
        "job": job_id,
        "window": window,
        "started_at": now.isoformat(),
        "completed_at": None,
        "status": "started",
        "result": None,
        "trigger": trigger,
        "force": force
    }
    
    runs_file = get_runs_file()
    with open(runs_file, 'a', encoding='utf-8') as f:
        f.write(json.dumps(run) + '\n')
    
    return run_id

def record_complete(run_id: str, status: str = "completed", result: str = None) -> None:
    """Record that a cron job completed."""
    now = datetime.now(EST)
    
    completion = {
        "id": run_id,
        "completed_at": now.isoformat(),
        "status": status,
        "result": result
    }
    
    runs_file = get_runs_file()
    with open(runs_file, 'a', encoding='utf-8') as f:
        f.write(json.dumps({"_update": run_id, **completion}) + '\n')

def record_skip(job_id: str, reason: str, existing_run: Dict = None) -> None:
    """Record that a cron job was skipped."""
    now = datetime.now(EST)
    window = get_window_key(job_id)
    
    skip = {
        "id": f"skip-{now.strftime('%Y%m%d-%H%M%S')}-{job_id}",
        "job": job_id,
        "window": window,
        "skipped_at": now.isoformat(),
        "status": "skipped",
        "reason": reason,
        "blocked_by": existing_run.get("id") if existing_run else None
    }
    
    runs_file = get_runs_file()
    with open(runs_file, 'a', encoding='utf-8') as f:
        f.write(json.dumps(skip) + '\n')

# CLI interface
if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Cron idempotency checker")
    parser.add_argument("command", choices=["check", "start", "complete", "skip", "list"])
    parser.add_argument("--job", help="Job ID")
    parser.add_argument("--run-id", help="Run ID for complete")
    parser.add_argument("--status", default="completed", help="Status for complete")
    parser.add_argument("--result", help="Result for complete")
    parser.add_argument("--reason", help="Reason for skip")
    parser.add_argument("--force", action="store_true", help="Force flag")
    args = parser.parse_args()
    
    if args.command == "check":
        if not args.job:
            print("Error: --job required")
            exit(1)
        result = check_idempotency(args.job)
        print(json.dumps(result, indent=2, default=str))
        exit(0 if result["should_run"] else 1)
    
    elif args.command == "start":
        if not args.job:
            print("Error: --job required")
            exit(1)
        run_id = record_start(args.job, force=args.force)
        print(f"Started: {run_id}")
    
    elif args.command == "complete":
        if not args.run_id:
            print("Error: --run-id required")
            exit(1)
        record_complete(args.run_id, args.status, args.result)
        print(f"Completed: {args.run_id}")
    
    elif args.command == "skip":
        if not args.job or not args.reason:
            print("Error: --job and --reason required")
            exit(1)
        record_skip(args.job, args.reason)
        print(f"Skipped: {args.job}")
    
    elif args.command == "list":
        runs = read_runs()
        for run in runs:
            print(json.dumps(run))
