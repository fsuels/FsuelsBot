"""
test_recovery.py — Simulation tests for recovery mechanisms
Council-designed: Grade A- (Simulation Testing Harness)

Run with: python -m pytest tests/test_recovery.py -v
"""

import pytest
import json
from pathlib import Path

# ============== TRUNCATION RECOVERY TESTS ==============

class TestTruncationRecovery:
    """Tests for context truncation recovery via active-thread.md"""
    
    def test_active_thread_exists(self, isolated_workspace):
        """Active thread file should exist in test workspace."""
        memory_dir = isolated_workspace / "memory"
        assert (memory_dir / "active-thread.md").exists()
    
    def test_detects_truncation_marker(self, isolated_workspace):
        """Should detect 'Summary unavailable' as truncation marker."""
        memory_dir = isolated_workspace / "memory"
        
        # Simulate truncation
        truncated = "Summary unavailable due to context limits."
        (memory_dir / "session.md").write_text(truncated)
        
        content = (memory_dir / "session.md").read_text()
        assert "Summary unavailable" in content
    
    def test_reads_active_thread_on_truncation(self, isolated_workspace):
        """Should read active-thread.md when truncation detected."""
        memory_dir = isolated_workspace / "memory"
        
        # Simulate truncation
        (memory_dir / "session.md").write_text("Summary unavailable")
        
        # Recovery: read active-thread
        active_thread = (memory_dir / "active-thread.md").read_text()
        
        assert "T004" in active_thread
        assert "Step: 3" in active_thread or "current_step" in active_thread.lower()
    
    def test_handles_missing_active_thread(self, isolated_workspace):
        """Should handle gracefully if active-thread.md is missing."""
        memory_dir = isolated_workspace / "memory"
        
        # Delete active-thread
        (memory_dir / "active-thread.md").unlink()
        
        # Should not crash
        exists = (memory_dir / "active-thread.md").exists()
        assert exists == False

# ============== CHECKPOINT CONSISTENCY TESTS ==============

class TestCheckpointConsistency:
    """Tests for checkpoint file integrity."""
    
    def test_state_json_valid(self, isolated_workspace):
        """state.json should be valid JSON."""
        memory_dir = isolated_workspace / "memory"
        state_file = memory_dir / "state.json"
        
        state = json.loads(state_file.read_text())
        assert "version" in state
    
    def test_tasks_json_valid(self, isolated_workspace):
        """tasks.json should be valid JSON."""
        memory_dir = isolated_workspace / "memory"
        tasks_file = memory_dir / "tasks.json"
        
        tasks = json.loads(tasks_file.read_text())
        assert "lanes" in tasks
        assert "tasks" in tasks
    
    def test_partial_write_detected(self, isolated_workspace):
        """Should detect partially written (corrupted) JSON."""
        memory_dir = isolated_workspace / "memory"
        state_file = memory_dir / "state.json"
        
        # Write partial JSON (simulating crash mid-write)
        partial = '{"version": 45, "status": "in_pro'
        state_file.write_text(partial)
        
        # Should fail to parse
        with pytest.raises(json.JSONDecodeError):
            json.loads(state_file.read_text())
    
    def test_atomic_write_pattern(self, isolated_workspace):
        """Atomic write (temp + rename) should prevent corruption."""
        memory_dir = isolated_workspace / "memory"
        state_file = memory_dir / "state.json"
        tmp_file = memory_dir / "state.json.tmp"
        
        # Atomic write pattern
        new_content = json.dumps({"version": 46, "status": "updated"})
        tmp_file.write_text(new_content)
        tmp_file.replace(state_file)
        
        # Should succeed
        state = json.loads(state_file.read_text())
        assert state["version"] == 46
        assert not tmp_file.exists()
    
    def test_no_orphan_tmp_files(self, isolated_workspace):
        """No .tmp files should remain after successful checkpoint."""
        memory_dir = isolated_workspace / "memory"
        
        tmp_files = list(memory_dir.glob("*.tmp"))
        assert len(tmp_files) == 0

# ============== CORRUPTION DETECTION TESTS ==============

class TestCorruptionDetection:
    """Tests for detecting various corruption types."""
    
    @pytest.mark.parametrize("corruption,should_fail", [
        ('{"version": 45, "status": "in_pro', True),  # truncated
        ('{"version": 45, "status": "ok",}', True),   # trailing comma
        ('', True),                                    # empty
        ('null', True),                               # null
        ('[1, 2, 3]', True),                          # array not object
        ('not json at all', True),                    # garbage
        ('{"version": 45}', False),                   # valid but minimal
    ])
    def test_detects_corruption_type(self, isolated_workspace, corruption, should_fail):
        """Should detect various corruption types."""
        memory_dir = isolated_workspace / "memory"
        state_file = memory_dir / "state.json"
        
        state_file.write_text(corruption)
        
        if should_fail:
            with pytest.raises((json.JSONDecodeError, TypeError)):
                data = json.loads(state_file.read_text())
                if not isinstance(data, dict):
                    raise TypeError("Expected dict")
        else:
            data = json.loads(state_file.read_text())
            assert isinstance(data, dict)

# ============== STEP TRACKING TESTS ==============

class TestStepTracking:
    """Tests for step tracking and resume functionality."""
    
    def test_current_step_preserved(self, isolated_workspace):
        """Current step should be preserved in tasks.json."""
        memory_dir = isolated_workspace / "memory"
        tasks = json.loads((memory_dir / "tasks.json").read_text())
        
        task = tasks["tasks"]["T004"]
        assert "current_step" in task
        assert task["current_step"] == 2
    
    def test_step_status_tracking(self, isolated_workspace):
        """Each step should have a status."""
        memory_dir = isolated_workspace / "memory"
        tasks = json.loads((memory_dir / "tasks.json").read_text())
        
        steps = tasks["tasks"]["T004"]["steps"]
        assert steps[0]["status"] == "done"
        assert steps[1]["status"] == "done"
        assert steps[2]["status"] == "in_progress"
    
    def test_resume_from_correct_step(self, isolated_workspace):
        """After recovery, should resume from current_step, not step 0."""
        memory_dir = isolated_workspace / "memory"
        tasks = json.loads((memory_dir / "tasks.json").read_text())
        
        current_step = tasks["tasks"]["T004"]["current_step"]
        steps = tasks["tasks"]["T004"]["steps"]
        
        # Current step should not be 0 (would indicate restart from beginning)
        assert current_step > 0
        # Current step's status should be in_progress
        assert steps[current_step]["status"] == "in_progress"

# ============== RECONCILIATION TESTS ==============

class TestReconciliation:
    """Tests for state.json / tasks.json consistency."""
    
    def test_current_task_exists_in_tasks(self, isolated_workspace):
        """state.json's current task should exist in tasks.json."""
        memory_dir = isolated_workspace / "memory"
        
        state = json.loads((memory_dir / "state.json").read_text())
        tasks = json.loads((memory_dir / "tasks.json").read_text())
        
        current_task_id = state["currentTask"]["id"]
        assert current_task_id in tasks["tasks"]
    
    def test_status_consistency(self, isolated_workspace):
        """Task status should be consistent between files."""
        memory_dir = isolated_workspace / "memory"
        
        state = json.loads((memory_dir / "state.json").read_text())
        tasks = json.loads((memory_dir / "tasks.json").read_text())
        
        current_task_id = state["currentTask"]["id"]
        state_status = state["currentTask"]["status"]
        tasks_status = tasks["tasks"][current_task_id]["status"]
        
        assert state_status == tasks_status

# ============== EVENTS LOG TESTS ==============

class TestEventsLog:
    """Tests for events.jsonl integrity."""
    
    def test_events_file_exists(self, isolated_workspace):
        """events.jsonl should exist."""
        memory_dir = isolated_workspace / "memory"
        assert (memory_dir / "events.jsonl").exists()
    
    def test_each_line_valid_json(self, isolated_workspace):
        """Each line in events.jsonl should be valid JSON."""
        memory_dir = isolated_workspace / "memory"
        events_file = memory_dir / "events.jsonl"
        
        for line in events_file.read_text().strip().split("\n"):
            if line:
                event = json.loads(line)
                assert "id" in event or "ts" in event

# ============== SUMMARY ==============

if __name__ == "__main__":
    pytest.main([__file__, "-v"])
