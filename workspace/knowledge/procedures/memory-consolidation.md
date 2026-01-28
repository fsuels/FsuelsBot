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

### 5. Confidence Decay (type-aware)
- Commitments: valid until status=closed (no time decay)
- Constraints: permanent unless superseded
- Preferences: stale if not referenced in 60 days
- Facts: warning at 30 days, drop from pack at 90 days
- Flag stale items in pack context section

### 6. Check Open Loops
- Read `memory/index/open-loops.json` (don't scan full ledger)
- Check for corresponding closing events → update index
- Surface all open commitments in pack, top 3 oldest first

### 7. Run Integrity Checks
- Validate: no duplicate IDs, valid JSON, valid supersession refs, valid related refs
- Log results to `memory/integrity-log.md`
- If any check fails: flag in pack context

### 8. Regenerate Recall Pack
- Rewrite `recall/pack.md` — single unified file
- Sections: P0 constraints, mantra, open commitments, waiting-on, focus, context, forecast, procedures, accounts
- Keep under 3,000 words

### 9. Update Checkpoint
- Write `memory/checkpoint.json` with last processed event ID and timestamp

### 10. Write Consolidation Report
- Create `knowledge/consolidation-reports/YYYY-MM-DD.md`
- Include: events extracted, knowledge updated, stale facts, open loops, conflicts, integrity, forecast

### 11. Git Versioning (Safety Net)
- Run `git add memory/ knowledge/ recall/ && git commit -m "consolidation YYYY-MM-DD"` BEFORE writing any changes
- This creates an automatic rollback point — one bad consolidation can be undone
- Zero cost, free safety net

### 12. Ledger Compaction Check (Monthly)
- Check if active (non-archived) events exceed **150**
- If yes, run compaction:
  1. Read full ledger
  2. For each resolved chain (commitment created → updated → closed): create ONE summary event
  3. Superseded facts → replaced by final correct fact as single event
  4. P0/P1 permanent constraints → preserved as-is
  5. Archive old events to `memory/ledger-archive-YYYY.jsonl`
  6. Write compacted events as new `memory/ledger.jsonl` (this is the ONE exception to append-only — compaction is a controlled rewrite)
  7. Reset checkpoint to reflect new ledger state
  8. Rebuild all indexes from scratch
- **Target:** Keep active ledger under 150 events at all times
- **Only runs monthly** (or when threshold exceeded)

## Notes
- Should NOT message Francisco (3 AM)
- Critical findings → log for 8 AM daily report
- Should take < 5 minutes (compaction may take longer)
- ALWAYS read checkpoint first → never process full ledger
- Git commit BEFORE writing changes (rollback safety)
