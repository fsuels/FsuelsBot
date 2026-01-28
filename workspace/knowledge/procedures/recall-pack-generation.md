# Procedure: Recall Pack Generation
*Last updated: 2026-01-28*
*Source: Council architecture*

## When to Use
- Automatically at 3 AM during consolidation
- On-demand when major context changes (new P0 constraint, new project, etc.)

## Steps

### 1. Gather P0 Constraints
- Scan `memory/ledger.jsonl` for all events with `"priority":"P0"`
- Include ALL of them — P0 is always loaded, no exceptions
- Also check `knowledge/principles/` for P0-priority files

### 2. Gather Open Commitments
- Scan ledger for `"type":"commitment"` events
- Exclude any that have a corresponding `"type":"milestone"` event confirming completion
- List each with: what, to whom, when due (if known), last action taken

### 3. Identify Waiting-On Items
- From open commitments, find any where we're waiting for external response
- Include: who we're waiting on, what for, when we last followed up

### 4. Determine Today's Focus
- Check active tasks (if task system exists)
- Check upcoming deadlines within 48 hours
- Check any scheduled events or reminders

### 5. Build Active Context
- Summarize current project status (DLM, any other active projects)
- Include recent decisions that affect today's work (last 72 hours)
- Note any recent conversations or directives from Francisco

### 6. Write the Pack
- Format as markdown following the template in memory-system.md
- **MUST stay under 3,000 words** — this is injected into every session
- Prioritize: P0 > open commitments > waiting-on > today's focus > context
- If space is tight, cut context section first

### 7. Save
- Write to `recall/pack.md`
- Note generation timestamp at the top

## Quality Checks
- Is every P0 constraint included? (if not, add it)
- Are there open commitments with no follow-up plan? (if so, flag them)
- Is the pack under 3,000 words? (if not, trim context section)
- Does the pack help someone with NO prior context understand what's happening? (if not, add more context)
