---
version: "1.0"
created: "2026-01-28"
updated: "2026-01-28"
verified: "2026-01-28"
confidence: "medium"
---

# Procedure: Memory Consolidation (Nightly — Incremental)
*Last updated: 2026-01-28*
*Source: Council architecture (Round 1 + Round 2 improvements)*

## When to Use
Runs automatically via cron at 3 AM EST daily. Can also be triggered manually.

## Key Principle: Incremental Processing
**Never process the entire ledger.** Read `memory/checkpoint.json` to find the last processed event, then only process new events. This prevents context window overflow as the ledger grows.

## Steps

### 0. Read Checkpoint + Index
- Read `memory/checkpoint.json` → `last_processed_event_id`, `events_processed`
- Read `memory/index/open-loops.json` (the only maintained index — entities and tags are derivable on-the-fly)
- This is your working state — no full ledger scan needed

### 1. Read Today's Raw Memory
- Open `memory/YYYY-MM-DD.md` for today's date
- If file doesn't exist or is empty, skip to step 5

### 2. Extract Structured Events (incremental)
For each noteworthy item in the daily log:
- **Skip items already live-extracted** (source: "live" events after checkpoint)
- Create JSONL event: ts, id, type, priority, content, entity, tags, source, session
- Valid types (7): `fact, decision, preference, commitment, constraint, procedure, relationship`
  - Use tags for: insight, milestone, conflict (not standalone types)
- For commitments: include `"status": "open"`
- For corrections: include `"supersedes": "EVT-XXX"`
- For related events: include `"related": ["EVT-XXX"]`
- Append to `memory/ledger.jsonl` (NEVER edit existing lines)
- Update `memory/index/open-loops.json` if commitment events are added

### 3. Update Knowledge Base
- **New entity?** → Create `knowledge/entities/<name>.md`
- **Updated info?** → Update entity file, add `[verified: YYYY-MM-DD]`
- **New procedure?** → Create `knowledge/procedures/<name>.md`
- **New rule?** → Create `knowledge/principles/<name>.md`
- **New insight?** → Update `knowledge/insights/<relevant>.md`

### 4. Auto-Detect Conflicts
- For new fact events: check same-entity events in index for contradictions
- If contradiction found: add ⚠️ Conflicts note to pack context section
- Human resolves by telling AI → creates superseding event

### 5. Confidence Decay (type-aware, binding types exempt)
**Binding types (NO automatic decay — require explicit status transition):**
- Commitments: active until status=closed/satisfied/withdrawn
- Constraints: permanent unless superseded or explicitly invalidated
- Procedures: permanent unless superseded
- Decisions: permanent unless superseded

**Decayable types (normal confidence decay):**
- Facts: warning at 30 days, drop from pack at 90 days
- Preferences: stale if not referenced in 60 days
- Relationships: warning at 60 days, drop at 120 days

Binding types can NEVER be removed from the pack by decay alone. They must have an explicit status change event in the ledger. This prevents the agent from silently forgetting obligations.

### 6. Check Open Loops
- Read `memory/index/open-loops.json` (don't scan full ledger)
- Check for corresponding closing events → update index
- Surface all open commitments in pack, top 3 oldest first

### 7. Run Integrity Checks (Memory Test Suite)
**Structural checks:**
- No duplicate event IDs
- Valid JSON on every ledger line
- Valid supersession refs (every `supersedes` points to a real event ID)
- Valid related refs (every `related` ID exists)

**Semantic checks (the important ones):**
- **No dangling supersessions:** every `supersedes` target exists in the ledger
- **Commitment non-decay rule:** no binding-type events (commitment, constraint, procedure, decision) excluded from pack by decay alone — must have explicit status change
- **P0/P1 coverage:** every active P0/P1 event appears in the recall pack (or has explicit exclusion reason)
- **Open-loop completeness:** every open commitment in ledger has entry in open-loops.json

**Output:** Write `memory/integrity-report.json` after each consolidation:
```json
{
  "ts": "2026-01-28T03:00:00Z",
  "checks_passed": 8,
  "checks_failed": 0,
  "failures": [],
  "warnings": []
}
```
If any check fails: flag in pack context section with ⚠️ warning. This turns silent failures into loud ones.

### 8. Persist Entity Snapshot
Write `memory/entity-snapshot.json` — a lightweight diffable receipt of derived state:
```json
{
  "generated": "2026-01-28T03:00:00Z",
  "entities": ["Francisco", "DressLikeMommy", "BuckyDrop"],
  "entity_count": 12,
  "tag_counts": {"shopify": 5, "memory": 8},
  "active_events": 67,
  "binding_events": 15,
  "decayable_events": 52
}
```
Compare with previous snapshot to detect: entity drift, canonicalization issues ("Acme" vs "ACME"), derivation bugs. Not a maintained index — just a diffable receipt.

### 9. Regenerate Recall Pack
- Rewrite `recall/pack.md` — single unified file
- Sections: P0 constraints, mantra, open commitments, waiting-on, focus, context, forecast, procedures, accounts
- Keep under 3,000 words

### 10. Update Checkpoint
- Write `memory/checkpoint.json` with last processed event ID and timestamp

### 11. Write Consolidation Report
- Create `knowledge/consolidation-reports/YYYY-MM-DD.md`
- Include: events extracted, knowledge updated, stale facts, open loops, conflicts, integrity, forecast

### 12. Git Versioning (Safety Net)
- Run `git add memory/ knowledge/ recall/ && git commit -m "consolidation YYYY-MM-DD"` BEFORE writing any changes
- This creates an automatic rollback point — one bad consolidation can be undone
- Zero cost, free safety net

### 13. Ledger Compaction (Event-Driven Archival)
**Trigger:** When a chain is fully resolved (commitment satisfied, fact superseded), start a 30-day timer. After 30 days with no new links to the chain, archive it.

**Process:**
1. Scan for resolved chains older than 30 days
2. For each resolved chain: create ONE summary event capturing the final state
3. P0/P1 permanent constraints → preserved as-is (never archived)
4. Archive old chain events to `memory/ledger-archive-YYYY.jsonl`
5. Write updated `memory/ledger.jsonl`
6. Reset checkpoint and rebuild indexes

**No arbitrary thresholds.** Compaction happens naturally as chains resolve, not on a monthly schedule. This scales with actual usage, not calendar time.

## Notes
- Should NOT message Francisco (3 AM)
- Critical findings → log for 8 AM daily report
- Should take < 5 minutes (compaction may take longer)
- ALWAYS read checkpoint first → never process full ledger
- Git commit BEFORE writing changes (rollback safety)
