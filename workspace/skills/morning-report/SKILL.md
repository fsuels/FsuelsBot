---
name: morning-report
description: "Generate daily briefing for Francisco via Telegram. Use when: (1) Triggered by morning cron/heartbeat, (2) Francisco asks 'what happened?', (3) After a night shift session completes. Compiles overnight work, store stats, and today's priorities."
---

# Morning Report

Generate a concise, data-driven daily briefing and send it via Telegram.

## Trigger Conditions

- Morning cron job (7 AM ET via gateway cron)
- Francisco asks "what happened?", "morning report", "briefing", "what did you do?"
- End of a night shift or long autonomous session

## Time Budget

**Total data gathering + formatting + send: <= 90 seconds.**
If any single data source takes >15 seconds, skip it and note "[source unavailable]" in the report.

---

## Step 1: Data Collection Spec

Run these commands/reads in parallel where possible. Each has a fallback.

### 1A. Tasks Completed Yesterday

**Source:** `workspace/memory/tasks.json` -- `lanes.done_today` array

```bash
python3 -c "
import json
d = json.load(open('workspace/memory/tasks.json'))
tasks = d.get('tasks', {})
done_ids = d.get('lanes', {}).get('done_today', [])
for tid in done_ids:
    t = tasks.get(tid, {})
    print(f\"- {t.get('summary', t.get('title', tid))}\")
"
```

**Fallback:** If tasks.json is corrupt or empty, report "No task data available."

### 1B. Currently Active Task

**Source:** `workspace/memory/tasks.json` -- `lanes.bot_current` array

```bash
python3 -c "
import json
d = json.load(open('workspace/memory/tasks.json'))
tasks = d.get('tasks', {})
current = d.get('lanes', {}).get('bot_current', [])
if not current:
    print('None')
else:
    for tid in current:
        t = tasks.get(tid, {})
        print(f\"- {t.get('summary', t.get('title', tid))}\")
"
```

### 1C. Queue Size and Top Items

**Source:** `workspace/memory/tasks.json` -- `lanes.bot_queue` array

```bash
python3 -c "
import json
d = json.load(open('workspace/memory/tasks.json'))
tasks = d.get('tasks', {})
queue = d.get('lanes', {}).get('bot_queue', [])
print(f'Queue size: {len(queue)}')
for tid in queue[:3]:
    t = tasks.get(tid, {})
    print(f\"- {t.get('summary', t.get('title', tid))}\")
if len(queue) > 3:
    print(f'  ...and {len(queue) - 3} more')
"
```

### 1D. Blocked Tasks

**Source:** `workspace/memory/tasks.json` -- `lanes.human` array + task `blockers` field

```bash
python3 -c "
import json, datetime
d = json.load(open('workspace/memory/tasks.json'))
tasks = d.get('tasks', {})
human = d.get('lanes', {}).get('human', [])
for tid in human:
    t = tasks.get(tid, {})
    blockers = t.get('blockers', [])
    updated = t.get('updated_at', 'unknown')
    summary = t.get('summary', t.get('title', tid))
    blocker_text = '; '.join(blockers) if blockers else 'awaiting human input'
    print(f\"- {summary} | Reason: {blocker_text} | Since: {updated}\")
"
```

### 1E. Git Activity (Last 24 Hours)

**Source:** Git log from the FsuelsBot repo.

```bash
cd /Users/fsuels/Projects/FsuelsBot && git log --oneline --since="yesterday" --until="today" 2>/dev/null | head -15
```

**Fallback:** If no commits, report "No commits in last 24h."

### 1F. Gateway Status

**Source:** `launchctl list bot.molt.gateway` (primary) or `moltbot channels status --probe` (secondary).

```bash
launchctl list bot.molt.gateway 2>/dev/null | head -3
```

Interpretation:

- Exit code 0 + PID shown = UP
- Exit code non-zero or no PID = DOWN

**If DOWN:** Attempt restart BEFORE generating the report (see Section 3).

### 1G. Error Count (Last 24 Hours)

**Source:** `/tmp/moltbot/moltbot-YYYY-MM-DD.log` (today) + yesterday's log.

```bash
TODAY=$(date +%Y-%m-%d)
YESTERDAY=$(date -v-1d +%Y-%m-%d)
ERROR_COUNT=0
for LOG in "/tmp/moltbot/moltbot-${YESTERDAY}.log" "/tmp/moltbot/moltbot-${TODAY}.log"; do
  if [ -f "$LOG" ]; then
    COUNT=$(grep -ci 'ERROR\|WARN\|FATAL' "$LOG" 2>/dev/null || echo 0)
    ERROR_COUNT=$((ERROR_COUNT + COUNT))
  fi
done
echo "Errors (24h): $ERROR_COUNT"
```

**Fallback:** If log files missing, report "Log files not found."

### 1H. New Memory Files

**Source:** `workspace/memory/` directory, files modified today.

```bash
TODAY=$(date +%Y-%m-%d)
find /Users/fsuels/Projects/FsuelsBot/workspace/memory/ -maxdepth 1 -name "${TODAY}*" -type f 2>/dev/null
```

### 1I. Daily Log Summary

**Source:** `workspace/memory/YYYY-MM-DD.md` (yesterday's dated log, if exists).

```bash
YESTERDAY=$(date -v-1d +%Y-%m-%d)
LOG="/Users/fsuels/Projects/FsuelsBot/workspace/memory/${YESTERDAY}.md"
if [ -f "$LOG" ]; then
  cat "$LOG"
else
  echo "No daily log for ${YESTERDAY}."
fi
```

---

## Step 2: Significance Thresholds

Apply these rules to determine what gets flagged in the report.

| Condition         | Threshold                       | Action                                                   |
| ----------------- | ------------------------------- | -------------------------------------------------------- |
| Error count (24h) | > 3                             | Flag as "Elevated error rate" with count                 |
| Task blocked      | > 24 hours (check `updated_at`) | Escalate: "STALE BLOCKER" label                          |
| Queue size        | > 10 items                      | Mention "Capacity concern: {N} tasks queued"             |
| Gateway down      | Any                             | **CRITICAL** -- restart before reporting, note in report |
| No commits (24h)  | 0 commits                       | Note "No code changes yesterday"                         |
| done_today empty  | 0 items                         | Note "No tasks completed" (may indicate idle/stuck)      |

---

## Step 3: Pre-Report Actions

Before generating the report, handle critical issues:

### Gateway Recovery (if DOWN)

```bash
pkill -9 -f moltbot-gateway || true
sleep 2
nohup moltbot gateway run --bind loopback --port 18789 --force > /tmp/moltbot-gateway.log 2>&1 &
sleep 3
moltbot channels status --probe
```

If recovery succeeds: report "Gateway: UP (auto-recovered)".
If recovery fails: report "Gateway: DOWN (recovery failed -- manual intervention needed)" and send a separate alert.

---

## Step 4: Report Template

Use this exact template. Fill variables from collected data. Do NOT deviate from this structure.

```
Morning Report -- {YYYY-MM-DD}

## Done Yesterday
{For each item in done_today lane, one bullet. If empty: "Nothing completed."}

## Active Now
{bot_current items. If empty: "No active task."}

## Queue ({count})
{Top 3 from bot_queue with summary. If >3, add "...and N more". If empty: "Queue empty."}

## Blockers
{Items from human lane with blocker reason and age. If none: "No blockers."}
{If any blocker > 24h, prefix with "STALE: "}

## System Health
- Gateway: {UP/DOWN/UP (auto-recovered)}
- Errors (24h): {count} {if >3: "-- ELEVATED"}
- Mission Control: {UP/DOWN/unknown}
{Any critical alerts from thresholds}

## Git Activity
{Commit summaries from last 24h, max 5. If none: "No commits."}

## Today's Priorities
1. {Highest-priority item from bot_queue or human lane that can be unblocked}
2. {Second priority}
3. {Third priority}
{Brief reasoning for each, e.g. "unblocked by yesterday's work" or "deadline approaching"}
```

### Priority Selection Logic

Pick today's priorities by scoring:

1. Items with explicit deadlines (soonest first)
2. Items that were unblocked by yesterday's completed work
3. Items in bot_queue by position (first = highest priority)
4. Stale blockers that might be resolvable without human input

---

## Step 5: Delivery

### Primary: Telegram

```bash
moltbot message send --channel telegram --target 8438693397 --text "{report_content}"
```

If the report exceeds Telegram's 4096-char limit, split into multiple messages:

1. First message: Done Yesterday + Active Now + Queue
2. Second message: Blockers + System Health + Git Activity + Priorities

### Fallback: File

If Telegram send fails, write report to:

```
workspace/memory/{YYYY-MM-DD}-morning-report.md
```

And log: "Morning report saved to file (Telegram send failed)."

---

## Tools Used

- `exec` -- bash commands for git log, launchctl, grep, find
- `read` -- tasks.json, daily logs, memory files
- `message send` -- Telegram delivery
- `exec` -- gateway restart (if needed)

---

## Rules

1. **Keep it SHORT.** Francisco wants a 30-second scan, not an essay.
2. **Lead with completed work** (positive), then issues.
3. **Always end with clear next actions** (Today's Priorities).
4. **If nothing happened overnight, say so honestly** -- do not pad with filler.
5. **Never claim data you did not read.** If a source is unavailable, say so.
6. **90-second hard cap** on data gathering. Skip slow sources.
7. **Gateway down = fix first, report second.** Never send a report while gateway is down (unless Telegram still works independently).
8. **Receipts rule applies.** Every data point in the report must come from a command output or file read in this session. No memory-based claims.
9. **No store/Shopify data** unless explicitly requested. The morning report focuses on bot operations, not storefront metrics. (Store snapshot is a separate skill.)
10. **Date handling:** "Yesterday" means calendar yesterday, not "last 24h" for task lanes. done_today lane may accumulate across sessions -- report all items present, noting the lane reflects recent completions.
