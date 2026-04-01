#!/usr/bin/env python3
"""
Regenerate state.json from tasks.json (canonical source)
Council Reconciliation Law: tasks.json -> state.json
"""

import json
from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo

WORKSPACE = Path(r"C:\dev\FsuelsBot\workspace")
TASKS_FILE = WORKSPACE / "memory" / "tasks.json"
STATE_FILE = WORKSPACE / "memory" / "state.json"
EST = ZoneInfo("America/New_York")

def regenerate():
    """Regenerate state.json from tasks.json."""
    
    # Read canonical source
    tasks = json.loads(TASKS_FILE.read_text(encoding='utf-8'))
    
    # Get current task
    bot_current = tasks.get("lanes", {}).get("bot_current", [])
    current_task_id = bot_current[0] if bot_current else None
    current_task = tasks.get("tasks", {}).get(current_task_id, {}) if current_task_id else {}
    
    # Get done today count
    done_today = tasks.get("lanes", {}).get("done_today", [])
    
    # Read existing state for version
    if STATE_FILE.exists():
        old_state = json.loads(STATE_FILE.read_text(encoding='utf-8'))
        version = old_state.get("version", 0) + 1
    else:
        version = 1
    
    # Build new state
    state = {
        "lastUpdated": datetime.now(EST).isoformat(),
        "version": version,
        "currentTask": {
            "id": current_task_id,
            "description": current_task.get("title", ""),
            "status": current_task.get("status", "unknown"),
            "owner": "bot",
            "currentStep": f"Step {current_task.get('current_step', 0)}" if current_task.get('steps') else current_task.get("notes", ""),
            "context": current_task.get("context", {}).get("summary", ""),
            "nextStep": current_task.get("approach", "")
        },
        "taskBoard": "memory/tasks.json",
        "derivedFrom": "tasks.json (canonical)",
        "regeneratedAt": datetime.now(EST).isoformat(),
        "completedTodayCount": len(done_today),
        "standingRules": [
            "UPDATE state.json BEFORE responding",
            "Dashboard must ALWAYS match what I report in chat",
            "SUGGESTION = FAILURE STATE",
            "NORTH STAR: Increase sales and make money"
        ]
    }
    
    # Write state
    STATE_FILE.write_text(json.dumps(state, indent=2, default=str), encoding='utf-8')
    print(f"Regenerated state.json (version {version})")
    return state

if __name__ == "__main__":
    regenerate()
