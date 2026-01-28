# Procedure: Recall Pack Generation (Delta Architecture)
*Last updated: 2026-01-28*
*Source: Council Round 1 — Delta Recall Pack innovation*

## When to Use
- Automatically at 3 AM during consolidation (delta only)
- On-demand when major context changes (new P0 → update core too)

## Delta Architecture

The pack is split into two files for efficiency:
- **`recall/core.md`** — Stable context (P0 constraints, mantra, procedures, account IDs). Rarely changes.
- **`recall/delta.md`** — Rolling context (commitments, waiting-on, focus, context). Rebuilt nightly.
- **`recall/pack.md`** — Combined view (core + delta). What sessions actually load.

Consolidation only rebuilds `delta.md` and `pack.md`. Core stays stable.

## Steps: Rebuild Delta

### 1. Gather Open Commitments
- Scan `memory/ledger.jsonl` for `"type":"commitment"` with `"status":"open"` (or no status)
- Exclude any with a corresponding closing event (`"status":"closed"`)
- Sort by age (oldest first)
- Surface the **top 3 oldest** prominently
- List all others below

### 2. Identify Waiting-On Items
- From open commitments, find external dependencies
- Include: who, what, when last followed up, age in days

### 3. Check Stale Facts (Confidence Decay)
- If any knowledge file facts are >30 days since `[verified: date]`, note in delta
- If any are >60 days, flag for re-verification

### 4. Determine Today's Focus
- Active tasks and deadlines within 48 hours
- Scheduled events or cron jobs
- Ongoing projects needing attention

### 5. Build Active Context
- Current project status (DLM, other active)
- Recent decisions (last 72 hours)
- Francisco's last known state/directives

### 6. Write Delta
- Write `recall/delta.md`
- Keep delta section under ~2,000 words

### 7. Combine into Pack
- Write `recall/pack.md` = contents of `core.md` + `---` separator + contents of `delta.md`
- Keep combined under 3,000 words total

## Steps: Update Core (rare)

Only when a new P0 constraint is established:
1. Add the constraint to `recall/core.md`
2. Rebuild `recall/pack.md`
3. Log the core change in the consolidation report

## Quality Checks
- Every P0 constraint in core? ✅
- Top 3 oldest open commitments in delta? ✅
- Stale facts flagged? ✅
- Combined pack under 3,000 words? ✅
- Superseded events excluded? ✅
