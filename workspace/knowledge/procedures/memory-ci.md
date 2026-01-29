---
version: "1.0"
created: "2026-01-28"
updated: "2026-01-28"
verified: "2026-01-28"
confidence: "medium"
---

# Procedure: Memory CI Test Harness
*Created: 2026-01-28*
*Source: Council Round 4 Debate (unanimous consensus)*
*Priority: P0 — This is the ONE thing standing between A- and A*

## Overview

The Memory CI is a validation suite that runs after every weekly rebuild (and can run on-demand). It turns silent failures into loud failures by checking structural integrity, semantic consistency, and behavioral contracts.

**Implementation:** Python scripts + jq queries
**When to run:** Weekly rebuild (Sunday 4 AM), after manual consolidation, on-demand
**Output:** `memory/ci-report.json` + console summary
**Cost:** $0 (all local processing)

## The 7 Check Categories

### 1. Schema Validation
- Every line in `ledger.jsonl` is valid JSON
- Required fields present: `ts`, `id`, `type`, `priority`, `content`, `source`
- `type` is one of the 7 valid types
- `priority` is P0, P1, P2, or P3
- `id` format is `EVT-YYYYMMDD-NNN`
- IDs are sequential per day (no gaps, no duplicates)

### 2. Graph Integrity
- Every `supersedes` field points to an existing event ID
- Every `related` field contains existing event IDs
- Supersession graph is acyclic (no loops)
- No event supersedes itself (directly or transitively)

### 3. Referential Integrity
- Every open commitment in `open-loops.json` exists in the ledger
- Every closed commitment has a closing event
- Entity names in events are consistent (canonicalized)

### 4. State Invariants
- No event is both active AND superseded (logical contradiction)
- Binding types (commitment, constraint, procedure, decision) with no explicit status change are NOT excluded from pack
- P0 events are NEVER excluded from pack
- P1 events are only excluded with explicit reason

### 5. Pack Contracts
- All pinned invariants (P0 constraints, mantra) appear in `recall/pack.md`
- Pack is under 3,000 words (excluding pinned content)
- Section order matches spec (P0 → MANTRA → OPEN COMMITMENTS → ...)
- Every open commitment in ledger appears in pack's OPEN COMMITMENTS section

### 6. Golden Snapshots (Regression Testing)
- Maintain `memory/ci-golden/` directory with known-good snapshots:
  - `golden-pack.md` — reference pack from last known-good state
  - `golden-integrity.json` — reference integrity report
- Compare current output to golden; flag significant divergence
- Update golden after intentional changes are verified

### 7. Diff Thresholds
- If pack changes by >30% word count between runs, flag for review
- If entity count changes by >20%, flag for review
- If >5 events are newly superseded in one consolidation, flag for review
- Thresholds prevent undetected drift

## Output Format

```json
{
  "ts": "2026-01-28T04:00:00Z",
  "version": "1.0",
  "checks": {
    "schema": {"passed": 67, "failed": 0, "errors": []},
    "graph_integrity": {"passed": true, "cycles": [], "dangling_refs": []},
    "referential": {"passed": true, "orphan_loops": [], "missing_closures": []},
    "state_invariants": {"passed": true, "violations": []},
    "pack_contracts": {"passed": true, "missing_pinned": [], "missing_commitments": []},
    "golden_diff": {"pack_word_delta": 42, "entity_delta": 0, "flags": []},
    "thresholds": {"passed": true, "exceeded": []}
  },
  "summary": {
    "total_checks": 7,
    "passed": 7,
    "failed": 0,
    "warnings": 0
  }
}
```

## Implementation Plan

### Phase 1: Core Checks (Week 1)
Create `scripts/memory-ci.py`:
- Schema validation (jq for JSON, Python for logic)
- Graph integrity (Python traversal)
- Referential integrity (cross-reference checks)
- State invariants (logic checks)

### Phase 2: Pack & Golden (Week 2)
- Pack contract validation
- Golden snapshot system
- Diff threshold alerts

### Phase 3: Integration (Week 3)
- Hook into weekly rebuild cron
- Automatic flagging in pack if CI fails
- Report to Telegram if critical issues found

## Running the CI

```bash
# Full CI run
python scripts/memory-ci.py --full

# Quick check (schema + graph only)
python scripts/memory-ci.py --quick

# Update golden snapshots
python scripts/memory-ci.py --update-golden

# CI with threshold override
python scripts/memory-ci.py --full --threshold-pack-delta 50
```

## When CI Fails

1. **Schema failure:** Fix the malformed event, re-run CI
2. **Graph failure:** Identify broken supersession chain, add corrective event
3. **State invariant failure:** Investigate why constraint was violated, fix root cause
4. **Pack contract failure:** Regenerate pack, check builder logic
5. **Threshold exceeded:** Review what changed, update golden if intentional

## Notes

- CI is a safety net, not a guarantee. It catches known failure modes.
- New failure modes should be added to CI as they're discovered.
- False positives are acceptable initially; tune thresholds over time.
- This is the bridge from A- to A. Take it seriously.
