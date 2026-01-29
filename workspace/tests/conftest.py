"""
conftest.py — Shared pytest fixtures for simulation testing
Council-designed: Grade A- (Simulation Testing Harness)
"""

import pytest
import json
import shutil
from pathlib import Path
from datetime import datetime

@pytest.fixture
def isolated_workspace(tmp_path):
    """
    Creates an isolated copy of memory files for testing.
    NEVER touches the real workspace.
    """
    memory_dir = tmp_path / "memory"
    memory_dir.mkdir()
    
    # state.json with known state
    state = {
        "version": 45,
        "lastUpdated": datetime.now().isoformat(),
        "currentTask": {
            "id": "T004",
            "description": "Test task",
            "status": "in_progress",
            "currentStep": 2
        }
    }
    (memory_dir / "state.json").write_text(json.dumps(state, indent=2))
    
    # tasks.json
    tasks = {
        "version": 10,
        "lanes": {
            "bot_current": ["T004"],
            "bot_queue": [],
            "human": [],
            "done_today": []
        },
        "tasks": {
            "T004": {
                "title": "Test task",
                "status": "in_progress",
                "steps": [
                    {"step": "Step 1", "status": "done"},
                    {"step": "Step 2", "status": "done"},
                    {"step": "Step 3", "status": "in_progress"},
                    {"step": "Step 4", "status": "pending"},
                    {"step": "Step 5", "status": "pending"}
                ],
                "current_step": 2
            }
        }
    }
    (memory_dir / "tasks.json").write_text(json.dumps(tasks, indent=2))
    
    # active-thread.md for truncation recovery
    active_thread = """# Active Thread

*Last updated: 2026-01-29 16:00 EST*

## Current Task: T004 - Test task
## Step: 3 of 5 (Step 3 in progress)
## Context: Testing recovery mechanisms

This file is the recovery point for context truncation.
"""
    (memory_dir / "active-thread.md").write_text(active_thread)
    
    # events.jsonl
    events = [
        {"id": "EVT-001", "type": "test", "ts": datetime.now().isoformat()}
    ]
    (memory_dir / "events.jsonl").write_text("\n".join(json.dumps(e) for e in events) + "\n")
    
    yield tmp_path
    # Cleanup happens automatically with tmp_path

@pytest.fixture
def mock_circuits(tmp_path):
    """Creates a mock circuits.json for circuit breaker testing."""
    memory_dir = tmp_path / "memory"
    memory_dir.mkdir(exist_ok=True)
    
    circuits = {
        "version": 1,
        "circuits": {
            "test_api": {
                "state": "closed",
                "failure_count": 0,
                "success_count": 0,
                "last_failure": None,
                "last_success": None,
                "opened_at": None
            }
        },
        "settings": {
            "failure_threshold": 3,
            "success_threshold": 2,
            "open_duration_ms": 300000
        }
    }
    (memory_dir / "circuits.json").write_text(json.dumps(circuits, indent=2))
    
    yield tmp_path
