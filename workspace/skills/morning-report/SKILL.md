---
name: morning-report
description: "Generate daily briefing for Francisco via Telegram. Use when: (1) Triggered by morning cron/heartbeat, (2) Francisco asks 'what happened?', (3) After a night shift session completes. Compiles overnight work, store stats, and today's priorities."
---

# Morning Report

Generate a concise daily briefing and send it via Telegram.

## Trigger Conditions

- Morning heartbeat/cron (if configured)
- Francisco asks "what happened?", "morning report", "briefing", "what did you do?"
- End of a long autonomous work session

## Report Structure

Send via `message send --channel telegram --target 8438693397`:

```
Good morning Francisco.

**Overnight Work**
- [What was completed — listings drafted, research done, audits run]
- [Files created/updated]
- [Issues found]

**Store Snapshot**
- Orders: [new/pending/fulfilled]
- Products: [active/draft count]
- Flags: [anything needing attention]

**Today's Priorities**
1. [Most important task]
2. [Second priority]
3. [Third priority]

**Blocked Items** (need your input)
- [Item + what's needed]
```

## How to Gather Data

### Overnight Work

1. Read recent session transcripts / state files
2. Check git log for recent commits
3. Read any notes left in memory files

### Store Snapshot

1. Use `browser` to check Shopify admin dashboard
2. Or use Shopify CLI if available
3. Check orders page for new/pending

### Priorities

1. Read `procedures/night-shift.md` backlog
2. Check knowledge files for pending tasks
3. Identify what's unblocked and highest-impact

### Blocked Items

1. Scan for HumanNeeded=Y in any ledger/state files
2. Check for auth issues (BuckyDrop login, etc.)
3. List items that need Francisco's decision

## Tools Used

- `message send` — Deliver report via Telegram
- `browser` — Check Shopify dashboard
- `exec` — Git log, file checks
- `read` — Session state, memory files, ledgers

## Rules

- Keep it SHORT. Francisco wants a 30-second scan, not an essay
- Lead with completed work (positive), then issues
- Always end with clear next actions
- If nothing happened overnight, say so honestly — don't pad
- Use emoji sparingly for scan-ability
