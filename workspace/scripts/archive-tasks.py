#!/usr/bin/env python3
"""
archive-tasks.py — Idempotent task archival for tasks.json

Moves done_today items older than 7 days to archived-tasks-{year}-Q{quarter}.json
and clears the trash lane. Safe to run multiple times.

Usage:
    python3 workspace/scripts/archive-tasks.py [--dry-run]
"""

import json
import sys
import os
from datetime import datetime, timezone, timedelta
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent.parent
TASKS_FILE = PROJECT_ROOT / "workspace" / "memory" / "tasks.json"
MEMORY_DIR = PROJECT_ROOT / "workspace" / "memory"

DRY_RUN = "--dry-run" in sys.argv
ARCHIVE_AFTER_DAYS = 7


def quarter_for_date(dt: datetime) -> int:
    return (dt.month - 1) // 3 + 1


def parse_date(date_str: str | None) -> datetime | None:
    if not date_str:
        return None
    try:
        return datetime.fromisoformat(date_str.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None


def get_task_date(task: dict) -> datetime | None:
    """Best-effort date extraction from a task."""
    return parse_date(task.get("created_at")) or parse_date(task.get("updated_at"))


def main():
    if not TASKS_FILE.exists():
        print(f"ERROR: {TASKS_FILE} not found")
        sys.exit(1)

    with open(TASKS_FILE) as f:
        data = json.load(f)

    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=ARCHIVE_AFTER_DAYS)

    # --- Identify tasks to archive from done_today ---
    to_archive: dict[str, dict] = {}
    keep_done: list[str] = []

    for tid in data["lanes"].get("done_today", []):
        task = data["tasks"].get(tid)
        if not task:
            # Ghost reference — drop silently
            continue
        dt = get_task_date(task)
        if dt is None or dt < cutoff:
            to_archive[tid] = task
        else:
            keep_done.append(tid)

    # --- Identify trash to purge ---
    trash_ids = list(data["lanes"].get("trash", []))
    trash_tasks: dict[str, dict] = {}
    for tid in trash_ids:
        if tid in data["tasks"]:
            trash_tasks[tid] = data["tasks"][tid]

    # --- Nothing to do? ---
    if not to_archive and not trash_ids:
        print("Nothing to archive or clean. Already up to date.")
        return

    # --- Determine archive file (by quarter of cutoff date) ---
    q = quarter_for_date(now)
    archive_filename = f"archived-tasks-{now.year}-Q{q}.json"
    archive_path = MEMORY_DIR / archive_filename

    # Load existing archive if present (idempotent merge)
    if archive_path.exists():
        with open(archive_path) as f:
            archive_data = json.load(f)
    else:
        archive_data = {
            "version": 1,
            "created_at": now.isoformat(),
            "description": f"Archived tasks for {now.year} Q{q}",
            "tasks": {},
            "also_purged_from_trash": {},
        }

    # Merge (don't overwrite existing entries — idempotent)
    for tid, task in to_archive.items():
        if tid not in archive_data["tasks"]:
            archive_data["tasks"][tid] = task

    for tid, task in trash_tasks.items():
        if tid not in archive_data.get("also_purged_from_trash", {}):
            archive_data.setdefault("also_purged_from_trash", {})[tid] = task

    archive_data["updated_at"] = now.isoformat()
    archive_data["version"] = archive_data.get("version", 0) + 1

    # --- Apply changes to tasks.json ---
    data["lanes"]["done_today"] = keep_done
    data["lanes"]["trash"] = []

    for tid in to_archive:
        data["tasks"].pop(tid, None)
    for tid in trash_ids:
        data["tasks"].pop(tid, None)

    data["updated_at"] = now.isoformat()
    data["updated_by"] = "archive-tasks.py"
    data["version"] = data.get("version", 0) + 1

    # --- Print summary ---
    mode = "[DRY RUN] " if DRY_RUN else ""
    print(f"{mode}Archive tasks older than {ARCHIVE_AFTER_DAYS} days (cutoff: {cutoff.date()})")
    print()

    if to_archive:
        print(f"  Archived {len(to_archive)} done_today tasks -> {archive_filename}:")
        for tid in to_archive:
            print(f"    - {tid}")
    else:
        print("  No done_today tasks to archive.")

    print()
    if trash_ids:
        print(f"  Purged {len(trash_ids)} trash entries:")
        for tid in trash_ids:
            print(f"    - {tid}")
    else:
        print("  Trash already empty.")

    print()
    print(f"  Remaining done_today: {len(keep_done)}")
    print(f"  Remaining total tasks: {len(data['tasks'])}")

    # --- Write files ---
    if not DRY_RUN:
        with open(archive_path, "w") as f:
            json.dump(archive_data, f, indent=2)
        with open(TASKS_FILE, "w") as f:
            json.dump(data, f, indent=2)
        print(f"\n  Written: {archive_path}")
        print(f"  Written: {TASKS_FILE}")
    else:
        print("\n  [DRY RUN] No files modified.")


if __name__ == "__main__":
    main()
