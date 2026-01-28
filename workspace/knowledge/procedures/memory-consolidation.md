# Procedure: Memory Consolidation (Nightly)
*Last updated: 2026-01-28*
*Source: Council architecture*

## When to Use
Runs automatically via cron at 3 AM EST daily. Can also be triggered manually.

## Steps

### 1. Read Today's Raw Memory
- Open `memory/YYYY-MM-DD.md` for today's date
- If file doesn't exist or is empty, skip to step 5

### 2. Extract Structured Events
For each noteworthy item in the daily log:
- Create a JSONL event object with: ts, id, type, priority, content, entity, tags, source, session
- Determine the correct type (fact, decision, preference, commitment, constraint, procedure, relationship, insight, milestone, conflict)
- Assign priority P0-P3 based on importance
- Append each event to `memory/ledger.jsonl` (NEVER edit existing lines)
- Use sequential IDs: EVT-YYYYMMDD-NNN (continue from last ID used for that date)

### 3. Update Knowledge Base
For each extracted event:
- **New entity mentioned?** → Create `knowledge/entities/<name>.md` from template
- **New info about existing entity?** → Update the entity file, add [verified: date]
- **New procedure discovered?** → Create `knowledge/procedures/<name>.md`
- **New rule or constraint?** → Create `knowledge/principles/<name>.md`
- **New insight or lesson?** → Create or update `knowledge/insights/<name>.md`
- Always note what changed at the bottom of updated files

### 4. Check for Conflicts
- Compare new events against existing knowledge
- If a new fact contradicts an existing one, log a `conflict` type event
- Update the knowledge file to reflect the latest information, noting the change

### 5. Check Confidence Decay
- Scan knowledge files for `[verified: YYYY-MM-DD]` dates
- Facts verified >30 days ago: flag as `[⚠️ STALE]` in delta pack
- Facts verified >60 days ago: exclude from delta pack unless explicitly relevant
- Preferences, principles, and identities do NOT decay

### 6. Check Open Loops
- Scan ledger for commitment events with `"status": "open"`
- Identify top 3 oldest open commitments
- Check if any have corresponding milestone/closing events → mark as closed
- Surface open commitments in delta pack

### 7. Regenerate Delta Pack (NOT core)
- Rewrite `recall/delta.md` — open commitments, waiting-on, today's focus, active context
- Rewrite `recall/pack.md` — combine `recall/core.md` + `recall/delta.md`
- Do NOT modify `recall/core.md` unless a new P0 constraint was discovered
- Keep combined pack under 3,000 words
- See procedure: recall-pack-generation.md for details

### 8. Write Consolidation Report
- Create `knowledge/consolidation-reports/YYYY-MM-DD.md`
- Include: events extracted, knowledge files updated, stale facts flagged, open loops status, conflicts found

## Notes
- The consolidation sub-agent runs with full access to the workspace
- It should NOT send messages to Francisco (it's 3 AM)
- If something critical is found (P0 conflict, data loss risk), log it for the 8 AM daily report
- Consolidation should take < 5 minutes
- Live-extracted events (source: "live") don't need re-extraction — skip them during step 2
