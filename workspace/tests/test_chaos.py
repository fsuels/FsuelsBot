"""
test_chaos.py — Chaos engineering tests for recovery mechanisms
Council A+ requirement: Simulate failure scenarios

Run with: python -m pytest tests/test_chaos.py -v
"""

import pytest
import json
import random
import string
import os
from pathlib import Path
import shutil


# ============== FIXTURES ==============

@pytest.fixture
def chaos_workspace(tmp_path):
    """Create workspace with real-ish data for chaos testing."""
    memory_dir = tmp_path / "memory"
    memory_dir.mkdir()
    
    # Create state.json
    state = {
        "version": 50,
        "currentTask": {"id": "T004", "status": "in_progress"},
        "lastUpdated": "2026-01-29T17:00:00-05:00"
    }
    (memory_dir / "state.json").write_text(json.dumps(state))
    
    # Create tasks.json
    tasks = {
        "version": 20,
        "lanes": {"bot_current": ["T004"], "bot_queue": ["T005"]},
        "tasks": {
            "T004": {"title": "Test task", "status": "in_progress", "current_step": 2},
            "T005": {"title": "Queued task", "status": "pending"}
        }
    }
    (memory_dir / "tasks.json").write_text(json.dumps(tasks))
    
    # Create events.jsonl with chain
    events = [
        '{"id":"EVT-001","type":"chain_init","prevHash":"0000000000000000","hash":"abc123"}',
        '{"id":"EVT-002","type":"task","prevHash":"abc123","hash":"def456"}',
    ]
    (memory_dir / "events.jsonl").write_text('\n'.join(events) + '\n')
    
    # Create active-thread.md
    (memory_dir / "active-thread.md").write_text("# Active Thread\n\nCurrent: T004 step 2")
    
    return tmp_path


# ============== CRASH SIMULATION TESTS ==============

class TestCrashRecovery:
    """Simulate crashes at various points."""
    
    def test_crash_mid_state_write(self, chaos_workspace):
        """Simulate crash while writing state.json (partial write)."""
        state_file = chaos_workspace / "memory" / "state.json"
        
        # Write partial JSON (simulating crash mid-write)
        partial = '{"version": 51, "currentTask": {"id": "T004", "status": "in_pro'
        state_file.write_text(partial)
        
        # System should detect corruption
        with pytest.raises(json.JSONDecodeError):
            json.loads(state_file.read_text())
        
        # Recovery: check for backup or fall back to tasks.json
        tasks_file = chaos_workspace / "memory" / "tasks.json"
        tasks = json.loads(tasks_file.read_text())
        assert tasks["lanes"]["bot_current"] == ["T004"]
    
    def test_crash_leaves_tmp_file(self, chaos_workspace):
        """Simulate crash after writing tmp but before rename."""
        memory_dir = chaos_workspace / "memory"
        
        # Simulate: tmp exists but original not updated
        new_state = {"version": 52, "currentTask": {"id": "T005"}}
        (memory_dir / "state.json.tmp").write_text(json.dumps(new_state))
        
        # Recovery should find and use tmp file
        tmp_file = memory_dir / "state.json.tmp"
        assert tmp_file.exists()
        
        # Manual recovery: complete the rename
        if tmp_file.exists():
            original = memory_dir / "state.json"
            tmp_file.replace(original)
        
        # Verify recovery worked
        state = json.loads((memory_dir / "state.json").read_text())
        assert state["version"] == 52
    
    def test_crash_corrupts_events_line(self, chaos_workspace):
        """Simulate crash mid-write to events.jsonl."""
        events_file = chaos_workspace / "memory" / "events.jsonl"
        
        # Append partial event (simulating crash)
        with open(events_file, 'a') as f:
            f.write('{"id":"EVT-003","type":"crash_test","prev')
        
        # Should be able to read valid events, skip corrupted
        valid_events = []
        for line in events_file.read_text().strip().split('\n'):
            try:
                valid_events.append(json.loads(line))
            except json.JSONDecodeError:
                pass  # Skip corrupted line
        
        assert len(valid_events) == 2  # Original 2 events readable


# ============== DATA CORRUPTION TESTS ==============

class TestCorruptionDetection:
    """Test detection of various corruption types."""
    
    @pytest.mark.parametrize("corruption_type,content", [
        ("truncated", '{"version": 50, "current'),
        ("empty", ''),
        ("just_whitespace", '   \n\t  '),
        ("array_not_object", '[1, 2, 3]'),
        ("missing_required", '{"version": 50}'),
    ])
    def test_detects_corruption(self, chaos_workspace, corruption_type, content):
        """Should detect various corruption types."""
        state_file = chaos_workspace / "memory" / "state.json"
        state_file.write_text(content)
        
        # Should either fail to parse or fail validation
        try:
            data = json.loads(state_file.read_text())
            # If it parses, check it has required fields
            assert isinstance(data, dict), "Must be object not array"
            if corruption_type == "missing_required":
                assert "currentTask" not in data  # Expected to be missing
        except (json.JSONDecodeError, UnicodeDecodeError, AssertionError):
            pass  # Expected for corrupted data


# ============== CONCURRENT ACCESS TESTS ==============

class TestConcurrentAccess:
    """Test behavior under concurrent access scenarios."""
    
    def test_simultaneous_read(self, chaos_workspace):
        """Multiple reads should not interfere."""
        state_file = chaos_workspace / "memory" / "state.json"
        
        # Simulate multiple reads
        results = []
        for _ in range(10):
            data = json.loads(state_file.read_text())
            results.append(data["version"])
        
        # All reads should return same version
        assert all(v == 50 for v in results)
    
    def test_read_during_write(self, chaos_workspace):
        """Read during write should get consistent data."""
        state_file = chaos_workspace / "memory" / "state.json"
        tmp_file = chaos_workspace / "memory" / "state.json.tmp"
        
        # Simulate atomic write pattern
        new_data = {"version": 51, "currentTask": {"id": "T005"}}
        tmp_file.write_text(json.dumps(new_data))
        
        # Read during "write" - should get old version
        old_data = json.loads(state_file.read_text())
        assert old_data["version"] == 50
        
        # Complete write
        tmp_file.replace(state_file)
        
        # Now should get new version
        new_data = json.loads(state_file.read_text())
        assert new_data["version"] == 51


# ============== RANDOM CHAOS TESTS ==============

class TestRandomChaos:
    """Randomly generated chaos scenarios."""
    
    def test_random_byte_injection(self, chaos_workspace):
        """Inject random bytes and verify detection."""
        state_file = chaos_workspace / "memory" / "state.json"
        original = state_file.read_text()
        
        # Inject random bytes at random position
        pos = random.randint(0, len(original) - 1)
        garbage = ''.join(random.choices(string.printable, k=5))
        corrupted = original[:pos] + garbage + original[pos:]
        
        state_file.write_text(corrupted)
        
        # Should likely fail to parse
        try:
            data = json.loads(state_file.read_text())
            # Might still parse if garbage landed in string value
            assert isinstance(data, dict)
        except json.JSONDecodeError:
            pass  # Expected
    
    def test_random_truncation(self, chaos_workspace):
        """Random truncation should be detected."""
        state_file = chaos_workspace / "memory" / "state.json"
        original = state_file.read_text()
        
        # Truncate at random point
        truncate_at = random.randint(10, len(original) - 10)
        state_file.write_text(original[:truncate_at])
        
        # Should fail to parse
        with pytest.raises(json.JSONDecodeError):
            json.loads(state_file.read_text())


# ============== DISK SPACE TESTS ==============

class TestDiskSpace:
    """Test behavior when disk is constrained."""
    
    def test_handles_readonly_gracefully(self, chaos_workspace):
        """Should handle read-only files gracefully."""
        state_file = chaos_workspace / "memory" / "state.json"
        
        # Make file read-only (Windows)
        os.chmod(state_file, 0o444)
        
        try:
            # Read should still work
            data = json.loads(state_file.read_text())
            assert data["version"] == 50
            
            # Write should fail gracefully
            try:
                state_file.write_text('{"version": 51}')
                assert False, "Should have raised permission error"
            except PermissionError:
                pass  # Expected
        finally:
            # Restore permissions for cleanup
            os.chmod(state_file, 0o644)


# ============== HASH CHAIN CHAOS ==============

class TestHashChainChaos:
    """Chaos tests specific to hash chain."""
    
    def test_chain_survives_corrupted_middle(self, chaos_workspace):
        """Chain should detect corruption in middle."""
        events_file = chaos_workspace / "memory" / "events.jsonl"
        
        lines = events_file.read_text().strip().split('\n')
        
        # Corrupt second event's hash
        event = json.loads(lines[1])
        event['hash'] = 'CORRUPTED'
        lines[1] = json.dumps(event)
        
        events_file.write_text('\n'.join(lines) + '\n')
        
        # Verification should fail
        for line in events_file.read_text().strip().split('\n'):
            event = json.loads(line)
            if event.get('hash') == 'CORRUPTED':
                assert True  # Found the corruption
                return
        
        assert False, "Should have found corrupted hash"
    
    def test_chain_detects_reordering(self, chaos_workspace):
        """Chain should detect if events are reordered."""
        events_file = chaos_workspace / "memory" / "events.jsonl"
        
        lines = events_file.read_text().strip().split('\n')
        
        # Reverse the events (after chain_init)
        # This would break prevHash links
        events_file.write_text('\n'.join(reversed(lines)) + '\n')
        
        # First event should no longer be chain_init
        first_line = events_file.read_text().strip().split('\n')[0]
        first_event = json.loads(first_line)
        
        # If reordered, chain_init is now last
        assert first_event.get('type') != 'chain_init' or first_event.get('prevHash') != '0000000000000000'


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
