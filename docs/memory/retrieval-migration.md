# Retrieval Migration Runbook

This runbook defines the required process when retrieval behavior changes because of:
- embedding model changes,
- BM25/tokenization changes,
- deterministic ranking threshold changes (`minSimilarity`, `overrideDelta`, near-tie epsilon),
- retrieval scope/routing changes.

## Goals

- Keep retrieval behavior auditable across deploys.
- Prevent silent relevance regressions.
- Ensure rollback is fast and deterministic.

## Required Signals

Before rollout, confirm diagnostics include:
- `memory.retrieval.configHash`
- `memory.retrieval.embeddingModel`
- `memory.retrieval.bm25ConfigVersion`

During rollout, monitor:
- `memory.alert` (`breached=true`)
- `memory.security` (`CRITICAL` events)
- retrieval result count distribution and top-k relevance fixtures.

## Pre Migration Checklist

1. Freeze old retrieval config and export baseline diagnostics.
2. Build labeled fixture set that covers:
   - in-scope task hits,
   - cross-task false positives,
   - pin/snapshot semantic override cases,
   - transcript tie-break behavior.
3. Run fixture evaluation on current production config.
4. Record baseline pass/fail and quality metrics.

## Migration Steps

1. Introduce new retrieval config in a controlled environment.
2. Reindex if embedding/tokenization changes require it.
3. Run the same fixture evaluation against new config.
4. Compare against baseline and confirm acceptance thresholds.
5. Deploy using staged rollout (small slice then full rollout).
6. Verify `memory.retrieval` version fields changed as expected.
7. Watch `memory.alert` and key retrieval quality dashboards for at least one full business cycle.

## Rollback Plan

1. Restore previous retrieval config values.
2. If embedding/model changed, restore previous index snapshot.
3. Confirm `memory.retrieval.configHash` and model fields match pre-migration baseline.
4. Re-run fixture set to verify rollback parity.

## Evidence Required For Completion

- Config diff (old vs new) with owner approval.
- Fixture report (before and after).
- Reindex logs if applicable.
- Deployment window and rollback readiness note.
- Post-rollout diagnostics sample with new version fields.
