---
updated: 2026-01-30
---

# Cron-to-Task System

**Purpose:** Every cron job creates a traceable task card in Mission Control.

## Why This Exists

Old broken system:
- Cron fires â†’ sends message â†’ message lost if bot idle â†’ no trace of what happened

New system:
- Cron fires â†’ creates task in bot_queue â†’ bot executes â†’ learnings captured â†’ full traceability

## How It Works

### 1. Cron Job Fires
The cron payload runs:
```bash
python scripts/cron-to-task.py --job-id "consolidation" --title "Memory Consolidation" --instructions "..."
```

### 2. Task Created in bot_queue
- Task ID: `CRON-YYYYMMDD-{job-id}` (e.g., `CRON-20260130-consolidation`)
- Appears in Mission Control immediately
- Has empty `learnings` section waiting to be filled

### 3. Bot Picks Up Task
- On next heartbeat, bot sees task in queue
- Moves to bot_current
- Executes the instructions

### 4. Bot Completes Task
When done, bot MUST fill in learnings:
```json
{
  "learnings": {
    "question": "What did Memory Consolidation produce?",
    "verdict": "15 events extracted, recall pack regenerated",
    "outcomes": ["3 knowledge files updated", "2 open loops closed"],
    "actionsTaken": ["Appended to ledger.jsonl", "Rebuilt recall/pack.md"],
    "artifacts": ["recall/pack.md", "memory/ledger.jsonl"]
  }
}
```

### 5. Task Moves to Done
- Francisco can click on completed task
- See full details + learnings
- Complete audit trail

## Idempotency

The script checks if `CRON-YYYYMMDD-{job-id}` already exists.
If it does, it skips creation. This prevents duplicate tasks if cron fires multiple times.

## Bot Protocol (MANDATORY)

When executing a CRON task:

1. **Read the instructions** from task.instructions
2. **Execute the work**
3. **BEFORE marking done**, update learnings:
   - `verdict`: One-line summary of what was accomplished
   - `outcomes`: List of specific results
   - `actionsTaken`: List of actions performed
   - `artifacts`: List of files created/modified
4. **Move to done_today**

**Never mark a CRON task done without filling learnings.**

## Creating New Cron Jobs

When adding a new cron job:

1. Set the payload to call `scripts/cron-to-task.py`
2. Include: --job-id, --title, --instructions
3. Instructions should be detailed enough for bot to execute independently

Example payload:
```
python scripts/cron-to-task.py --job-id "research-brief" --title "Daily AI Research Brief" --instructions "1. Search web for AI agent news. 2. Check X feed. 3. Compile brief. 4. Send to Francisco on Telegram."
```

## Existing Jobs to Convert

- [x] Script created: scripts/cron-to-task.py
- [ ] memory-consolidation (3 AM)
- [ ] daily-ai-research-brief (9 AM)
- [ ] curiosity-engine (9 PM)
- [ ] compound-learn (10:30 PM)
- [ ] compound-ship (11 PM)
- [ ] daily-github-backup (11:45 PM)

