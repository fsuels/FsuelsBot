# Cron Jobs -- Scheduling, Execution, and Quality Control

_Version: 2.0 -- 2026-03-31_

## 1. Gateway Cron Schema (Correct Format)

The `cron` tool has a strict schema. Use this exact structure:

```json
{
  "action": "add",
  "job": {
    "name": "Morning brief",
    "enabled": true,
    "schedule": { "kind": "cron", "expr": "0 7 * * *", "tz": "America/New_York" },
    "sessionTarget": "main",
    "wakeMode": "next-heartbeat",
    "payload": {
      "kind": "systemEvent",
      "text": "Reminder: send Francisco the morning brief..."
    }
  }
}
```

### Payload Types

- `systemEvent`: fires as a system reminder text
- `agentTurn`: sends a message into the agent session (optionally with model/thinking overrides)

### Notes

- Prefer `wakeMode: "next-heartbeat"` for scheduled jobs
- Use `sessionTarget: "main"` unless isolation is required

---

## 2. Cron Job Definition Template

Every scheduled job MUST include these fields when registered:

```yaml
job_id: "unique-kebab-case-id"
title: "Human-readable title (Time)"
schedule: "cron expression + timezone"
category: core | marketing | monitoring | maintenance
enabled: true | false

# Trigger
trigger_condition: "Time-based: cron expr | Event-based: description"

# Execution
instructions: |
  Numbered steps the bot executes. Each step must be:
  1) Concrete (no "consider" or "if appropriate")
  2) Verifiable (produces observable output)
  3) Time-bounded (include timeout per step if >5 min)

# Quality
acceptance_criteria:
  - "Criterion 1: specific observable outcome"
  - "Criterion 2: artifact exists at path"
  - "Criterion 3: notification sent with receipt"

success_output: "What a successful run produces (file, message, commit)"
failure_output: "What to log when the run fails"

# Guards
executability_requirements:
  - "Requirement 1: e.g., 'git CLI available'"
  - "Requirement 2: e.g., 'browser session with X login'"
pre_check: "Command or condition that MUST pass before task creation"

# Limits
max_instances_per_day: 1
dedup_key: "CRON-YYYYMMDD-{job_id}"
timeout_minutes: 15
```

---

## 3. Executability Gate (BEFORE Task Creation)

**No cron may create a task unless its pre-check passes.**

When a cron fires, the bot MUST run this sequence:

```
1. Check dedup: Does CRON-YYYYMMDD-{job_id} already exist in tasks.json?
   YES -> SKIP (log: "dedup skip")

2. Check executability: Can all executability_requirements be satisfied?
   - File/tool requirements: verify with filesystem/command check
   - Browser session requirements: check if session is attached
   - Credential requirements: check if credentials are available
   NO -> SKIP + increment failure counter (log: "executability skip: {missing requirement}")

3. Check failure history: Has this job failed 3+ consecutive times?
   YES -> DISABLE the cron job + create ONE escalation task for Francisco

4. All gates pass -> Create task in bot_queue
```

### Executability Blocklist (Permanently Disabled)

These crons are DISABLED because their requirements cannot be met:

| Job ID                    | Reason                                              | Disabled Date |
| ------------------------- | --------------------------------------------------- | ------------- |
| buckydrop-check           | Requires Outlook + BuckyDrop login, never available | 2026-03-18    |
| openclaw-x-engagement     | Requires authenticated X session                    | 2026-03-18    |
| moltbook-x-engagement     | Requires authenticated X session                    | 2026-03-18    |
| credibility-monitor-10am  | Requires authenticated X session                    | 2026-03-18    |
| influencer-outreach-daily | Requires authenticated X session                    | 2026-03-18    |
| linkedin-marketing        | Requires authenticated LinkedIn session             | 2026-03-18    |
| x-daily-marketing         | Requires authenticated X session                    | 2026-03-18    |
| aplus-validation          | Council validation concept deprecated               | 2026-03-18    |
| self-improvement (weekly) | Low output density; change to monthly if re-enabled | 2026-03-31    |

**Rule:** Blocked crons stay disabled until Francisco explicitly enables them with evidence that the blocker is resolved.

---

## 4. 3-Strike Escalation System

Failure counter is tracked per `job_id` and resets on any `success` or `partial` completion.

| Condition              | Action                                                     |
| ---------------------- | ---------------------------------------------------------- |
| 1 failure              | Log to `workspace/memory/error-log.jsonl`                  |
| 2 consecutive failures | Log + add note to next morning report                      |
| 3 consecutive failures | Log + DISABLE cron + send Telegram escalation to Francisco |

### Error Log Format

Failed cron tasks MUST append an entry to `workspace/memory/error-log.jsonl`:

```json
{
  "error_id": "ERR-CRON-{date}-{job_id}",
  "timestamp": "ISO-8601",
  "failure_mode": "Description of what failed",
  "root_cause": "Why it failed",
  "context": { "task_id": "CRON-YYYYMMDD-{job_id}", "cron_job_id": "{job_id}" },
  "fix_applied": "What was tried | null",
  "fix_worked": false,
  "severity": "low | medium | high",
  "tags": ["cron", "{job_id}"]
}
```

### Completion Status Taxonomy

Every completed cron task MUST have one of these statuses:

| Status    | Meaning                              | Learnings Required                 |
| --------- | ------------------------------------ | ---------------------------------- |
| `success` | All acceptance criteria met          | Full learnings object              |
| `partial` | Some criteria met, degraded output   | Learnings + list of unmet criteria |
| `failed`  | No criteria met, no useful output    | Error description + root cause     |
| `skipped` | Pre-check failed, task never created | Log entry only (no task card)      |

### Required Learnings Structure

```json
{
  "learnings": {
    "completion_status": "success | partial | failed",
    "verdict": "One-line summary of what was accomplished",
    "outcomes": ["Specific result 1", "Specific result 2"],
    "actionsTaken": ["Action 1 with receipt", "Action 2 with receipt"],
    "artifacts": ["path/to/file1", "path/to/file2"],
    "unmet_criteria": [],
    "error": null
  }
}
```

---

## 5. Deduplication System

### 5.1 ID-Based Dedup (Existing)

Task ID format: `CRON-YYYYMMDD-{job_id}`

If this ID exists in any lane of tasks.json, skip creation.

### 5.2 Semantic Dedup

Before creating a cron task, also check:

1. **Same job_id within sliding 24h window:** If a task with the same `cron_job_id` was created in the last 24 hours AND is still in `bot_queue` or `bot_current`, do not create another.
2. **Title similarity > 80%:** If any task in `bot_queue` or `bot_current` has >80% title overlap with the new cron task, skip.
3. **Max instances per day:** Each cron type has a `max_instances_per_day` cap (default: 1). If the cap is reached, skip.

### 5.3 IGNORE Blocklist

These patterns should be silently dropped without creating tasks:

| Pattern                                               | Reason                     |
| ----------------------------------------------------- | -------------------------- |
| Any cron requiring `X session` when no X login exists | Permanently blocked        |
| `buckydrop-check`                                     | Permanently blocked        |
| `aplus-validation`                                    | Deprecated                 |
| Research reviews for domains known to be parked       | Produces zero-value output |

---

## 6. Active Cron Schedule

### 6.1 Core Schedule (All Healthy)

| Time (ET) | Job ID           | Category    | Max/Day | Timeout |
| --------- | ---------------- | ----------- | ------- | ------- |
| 3:00 AM   | `consolidation`  | maintenance | 1       | 15 min  |
| 9:00 AM   | `research-brief` | core        | 1       | 20 min  |
| 9:00 PM   | `curiosity`      | core        | 1       | 15 min  |
| 10:30 PM  | `learn`          | maintenance | 1       | 15 min  |
| 11:00 PM  | `ship`           | core        | 1       | 45 min  |
| 11:45 PM  | `backup`         | maintenance | 1       | 10 min  |

### 6.2 Recommended Changes Applied

| Job                          | Was             | Now                                    | Reason                                  |
| ---------------------------- | --------------- | -------------------------------------- | --------------------------------------- |
| epistemic-review-morning     | Daily 9 AM      | **Disabled**                           | 50%+ trash rate, blocker never resolved |
| epistemic-review-evening     | Daily 9 PM      | **Merged into `learn`**                | Overlapping function                    |
| self-improvement             | Weekly Mon 6 AM | **Monthly** (1st Monday) if re-enabled | Low output density                      |
| buckydrop-check              | 2x daily        | **Disabled**                           | 100% trash rate                         |
| All marketing crons (6 jobs) | Daily various   | **Disabled**                           | 100% trash rate; no browser sessions    |

### 6.3 Net Effect

- **Before:** 17 cron types, ~15 tasks/day created, ~5 trashed daily (33% waste)
- **After:** 6 cron types, 6 tasks/day created, ~0 trashed (0% waste target)

---

## 7. Acceptance Criteria for Each Active Cron

### consolidation (3 AM)

- [ ] Git safety commit created before consolidation starts
- [ ] At least 1 event extracted to ledger.jsonl OR "no events today" logged
- [ ] recall/pack.md regenerated with timestamp
- [ ] Git commit with changes pushed

### research-brief (9 AM)

- [ ] At least 1 actionable finding with source URL
- [ ] Brief sent to Francisco via Telegram with receipt
- [ ] Findings logged to a structured file (not just chat)

### curiosity (9 PM)

- [ ] Max 3 proposals generated with TPS scores
- [ ] Each proposal has: title, description, estimated effort, expected impact
- [ ] Proposals appended to backlog.md
- [ ] No proposals in FORBIDDEN categories (new product categories, new traffic channels, brand pivots)

### learn (10:30 PM)

- [ ] Today's memory file read
- [ ] Git commits from past 24h reviewed
- [ ] Max 5 lessons extracted in Context/Failure/Fix/Prevention format
- [ ] Relevant knowledge files updated
- [ ] Git commit with "nightly-learn" prefix

### ship (11 PM)

- [ ] Highest TPS task from backlog selected
- [ ] Task executed with output scored using 4-layer cascade
- [ ] If score >= 0.8: draft saved and committed
- [ ] Overnight report prepared for Francisco

### backup (11:45 PM)

- [ ] `git add workspace/` executed
- [ ] `git commit` with "daily-backup YYYY-MM-DD" message
- [ ] `git push` with success/failure receipt
- [ ] File count or "nothing to sync" logged

---

## 8. Integration Points

### Cron -> Task Queue

```
Cron fires
  -> Bot runs pre-checks (Section 3)
  -> If passes: creates task in bot_queue with CRON-YYYYMMDD-{job_id}
  -> Bot heartbeat picks up from bot_queue (HEARTBEAT.md Section 0)
  -> Bot executes per instructions
  -> Bot fills learnings (Section 4)
  -> Bot moves to done_today
```

### Cron Results -> Morning Report

The morning report should:

1. Count cron tasks completed overnight (from done_today with `created_by: "cron"`)
2. List any `partial` or `failed` cron results with one-line summaries
3. Flag any disabled crons (escalation from 3-strike rule)

### Cron Failures -> Error Log

Path: `workspace/memory/error-log.jsonl`

Every cron `failed` status writes to this log using the format in Section 4. The morning report reads the last 24h of this file to surface overnight failures.

### Cron -> Night Shift

Per `procedures/night-shift.md`, overnight crons (consolidation, learn, ship, backup) are the bot's primary night-shift structure. The night-shift protocol should treat cron completion as checkpoints, not as the entirety of overnight work.
