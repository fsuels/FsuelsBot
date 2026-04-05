---
title: Fsuels Evolve v0 — Phase 1 (Safety-First Evaluator + Benchmark Pack)
status: completed
updated: 2026-04-05
owner: FsuelsBot
approved_by: Francisco
approved_via: "Telegram message_id 7944: 'Ok do it'"
---

# 1) Goal
Build a safe, auditable Phase 1 foundation for improvement experiments:
- fixed benchmark task pack
- deterministic evaluator
- strict hard-fail gates for truthfulness and safety

No mutation engine in this phase.

# 2) Scope
## In Scope
1. Create benchmark pack (train/test split)
2. Create evaluator script for run scoring
3. Enforce hard-fail gates:
   - truthfulness violations
   - safety violations
4. Emit machine-readable evaluation summary JSON

## Out of Scope
- Any automatic prompt/code mutation
- Automatic promotion to production behavior
- Changes to SOUL.md / safety policy files

# 3) Risks (critical first)
1. **Metric gaming risk** — candidate can improve weighted score while hiding unacceptable behavior.
   - Mitigation: hard-fail gates for truthfulness/safety regressions.
2. **Overfitting risk** — candidate passes train tasks but fails realistic unseen tasks.
   - Mitigation: required held-out test split and separate reporting.
3. **Noisy scoring risk** — inconsistent manual labels invalidate comparisons.
   - Mitigation: strict rubric + explicit score schema + normalized numeric scales.

# 4) Files
- `memory/benchmarks/fsuels-evolve-v0-benchmark.json` (new)
- `scripts/fsuels-evolve-evaluator.py` (new)
- `templates/fsuels-evolve-run-template.json` (new)

# 5) Verification
1. Run evaluator on template baseline/candidate file
2. Confirm evaluator writes summary JSON with:
   - per-split metrics (train/test)
   - hard-fail status
   - promotion recommendation
3. Confirm candidate with truthfulness/safety fail is rejected even if weighted score is better

# 6) Rollback
Delete the three new files. No existing runtime behavior is modified in Phase 1.
