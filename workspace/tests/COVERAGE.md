# Test Coverage Matrix

**Council A+ Requirement:** Map tests → failure modes → invariants

---

## Recovery Tests (23 tests in test_recovery.py)

| Test | Failure Mode | Invariant Protected |
|------|--------------|---------------------|
| test_active_thread_exists | Missing recovery file | Session continuity |
| test_detects_truncation_marker | Context truncation | Step tracking works |
| test_reads_active_thread_on_truncation | Recovery protocol | Resume from correct step |
| test_handles_missing_active_thread | Missing file gracefully | No crash on missing |
| test_state_json_valid | Corrupted state | Valid JSON always |
| test_tasks_json_valid | Corrupted tasks | Valid JSON always |
| test_partial_write_detected | Crash mid-write | Corruption detectable |
| test_atomic_write_pattern | Non-atomic write | Atomic writes succeed |
| test_no_orphan_tmp_files | Leftover temp files | Clean after checkpoint |
| test_detects_corruption_type (7 params) | Various corruptions | All detected |
| test_current_step_preserved | Step lost | Step tracking persists |
| test_step_status_tracking | Status lost | Status persists |
| test_resume_from_correct_step | Wrong step resume | Correct step resumed |
| test_current_task_exists_in_tasks | Orphan reference | Referential integrity |
| test_status_consistency | State/tasks drift | Consistency maintained |
| test_events_file_exists | Missing event log | Audit trail exists |
| test_each_line_valid_json | Corrupted events | Events parseable |

## Chaos Tests (15 tests in test_chaos.py)

| Test | Chaos Scenario | Invariant Protected |
|------|----------------|---------------------|
| test_crash_mid_state_write | Power loss mid-write | Backup recovery works |
| test_crash_leaves_tmp_file | Incomplete transaction | Recovery completes txn |
| test_crash_corrupts_events_line | Partial event write | Other events readable |
| test_detects_corruption (5 params) | Random corruption types | All detected |
| test_simultaneous_read | Concurrent reads | No interference |
| test_read_during_write | Read during atomic write | Consistent read |
| test_random_byte_injection | Random data corruption | Detection works |
| test_random_truncation | Random file truncation | Always detected |
| test_handles_readonly_gracefully | Permission error | Graceful failure |
| test_chain_survives_corrupted_middle | Hash chain tampering | Tampering detected |
| test_chain_detects_reordering | Event reordering | Order verified |

---

## Failure Mode Coverage Analysis

### Covered ✅
- JSON corruption (truncation, invalid, empty, wrong type)
- Crash recovery (mid-write, incomplete transaction)
- Concurrent access (read/read, read/write)
- Hash chain integrity (tampering, reordering)
- File system issues (permission, missing files)
- Step tracking (preservation, resumption)
- State consistency (state.json ↔ tasks.json)

### Not Yet Covered ⚠️
- Disk full (ENOSPC) - need mock
- Network partition (N/A for single node)
- Clock skew - need time injection
- Memory pressure (OOM) - hard to simulate

---

## How to Run

```bash
# All tests
python -m pytest tests/ -v

# Recovery tests only
python -m pytest tests/test_recovery.py -v

# Chaos tests only  
python -m pytest tests/test_chaos.py -v

# With coverage report
python -m pytest tests/ --cov=scripts --cov-report=html
```

---

**Last Updated:** 2026-01-29
**Council Requirement:** A+ Simulation Testing
