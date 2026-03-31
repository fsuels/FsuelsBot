# HEARTBEAT.md — Control Loop (Proactive, Non-Stop Execution)

_Last reviewed: 2026-03-31_

Purpose: The heartbeat is a fast control loop that keeps the system safe, truthful, and continuously executing tasks. It must be resilient to partial tool failure and must never claim actions without receipts.

---

## 0) Auto-Continue Protocol (ABSOLUTE FIRST — BEFORE EVERYTHING)

**THIS CHECK RUNS BEFORE ALL OTHER HEARTBEAT ACTIONS.**

```bash
# Check if bot_current has tasks (macOS — jq or python3)
jq -e '.lanes.bot_current | length > 0' workspace/memory/tasks.json
```

**If `bot_current` has ANY tasks:**

1. DO NOT run epistemic checks
2. DO NOT run infrastructure checks
3. DO NOT run predictions review
4. DO NOT reply HEARTBEAT_OK
5. IMMEDIATELY execute the first task in `bot_current`
6. Only run other heartbeat checks when `bot_current` is EMPTY

**The heartbeat exists to EXECUTE, not to "check in".**

**If you just finished a task:**

1. Check if more tasks exist in `bot_current`
2. If YES → Start next task immediately (no heartbeat checks needed)
3. If NO → Run full heartbeat checks below

---

## 1) Epistemic Health Check (EVERY HEARTBEAT — FIRST)

Motto:

```
EVERY response I give
EVERY analysis I make
EVERY recommendation I offer
EVERY claim I accept
EVERY action I take
        ↓
   SOUND LOGIC
 VERIFIED EVIDENCE
   NO FALLACIES
```

Before any action:

- [ ] Am I making assumptions without evidence?
- [ ] Am I at risk of a known fallacy (authority, bandwagon, false cause)?
- [ ] If I cannot verify, will I explicitly say NO_CITABLE_EVIDENCE / INSUFFICIENT_EVIDENCE?
- [ ] Will I avoid claiming actions without receipts?

If uncertain → verify (tools/logs) or downgrade confidence. Never guess.

---

## 1) Heartbeat Time Budget (non-negotiable)

- Heartbeat overhead work budget: **<= 90 seconds**
- If overhead exceeds budget: stop overhead and return to task execution.
- Goal: do not starve the task queue.

---

## 2) Tier-0 Combined Checks (EVERY heartbeat)

Run inline checks (no external script required):

```bash
# Validate tasks.json is parseable JSON
python3 -c "import json; json.load(open('workspace/memory/tasks.json'))" 2>&1

# Check Mission Control is reachable (if applicable)
curl -s -o /dev/null -w '%{http_code}' http://localhost:8765/ 2>/dev/null || echo "mc_down"

# Check gateway status
launchctl list bot.molt.gateway 2>/dev/null | head -1 || echo "gateway_unknown"
```

Receipts rule:

- Treat the returned output as the only source of truth for what happened.
- If checks error: record the error and continue with minimal safe mode (Section 5).

---

## 3) Tasks.json Integrity Gate (BEFORE ANY WRITE)

Before ANY modification to tasks.json, validate integrity:

```bash
# Validate tasks.json structure: all lane IDs must exist in tasks object
python3 -c "
import json, sys
d = json.load(open('workspace/memory/tasks.json'))
task_ids = set(d.get('tasks', {}).keys())
for lane, ids in d.get('lanes', {}).items():
    for tid in ids:
        if tid not in task_ids:
            print(f'ORPHAN: {lane} references missing task {tid}')
            sys.exit(1)
print('OK')
"
```

Rules:

- If validation fails: **DO NOT WRITE** to tasks.json.
- Immediately notify Francisco with the error output + suspected root cause.
- Move any work that requires tasks.json writes into WAITING_HUMAN.

Root cause record (2026-02-01):

- Lane arrays referenced task IDs without definitions = corruption.

---

## 4) Mission Control / Infra Checks (Capability-Gated)

Mission Control is critical, but do not claim it's running unless you have receipts.

- Use `curl -s http://localhost:8765/` to check if Mission Control responds.
- If port 8765 is down and the runtime supports restart:
  - Check if the process exists and restart if needed.
- If a restart occurred AND Telegram send is available:
  - Send Francisco the mobile URL.

Dashboard URLs:

- PC: `http://localhost:8765`
- Mobile (WiFi): `http://192.168.4.25:8765?key=a6132abf77194fd10a77317a094771f1`

Receipts rule:

- If you cannot confirm restart + send, report BLOCKER instead of claiming completion.

---

## 5) Minimal Safe Mode (when checks/tools fail)

If Tier-0 checks fail (tool missing, JSON invalid, network down):

1. Do not write to tasks.json
2. Do not claim infra status
3. Continue task execution only for tasks that do not require:
   - browser automation
   - external sends
   - destructive ops
   - state persistence writes
4. Report one-line blocker:
   - BLOCKER: heartbeat checks unavailable (include error) — continuing with safe tasks only.

---

## 6) The Non-Stop Task Runner Loop (PRIMARY PURPOSE)

Heartbeat is not a report generator; it is the dispatcher.

### Task state machine (required)

Process tasks in this order until no runnable tasks remain:

- Runnable: NEW, IN_PROGRESS
- Non-runnable: WAITING_HUMAN, WAITING_EXTERNAL, DONE, FAILED

### Rule: Never stop on blockers

If a task hits a blocker that requires a human:

- Move task to WAITING_HUMAN ("human column")
- Record the minimum needed input (1–3 items) + one direct question + two options
- Notify Francisco concisely
- Immediately continue to the next runnable task

If a task is blocked by rate limits/vendor delays:

- Move to WAITING_EXTERNAL with a retry note/backoff
- Continue

### Atomic step discipline

Each execution slice:

- <= 1–3 tool calls OR <= ~5 minutes of work per task before yielding
- Always write receipts (diff, command output, screenshot ref, log line)

### Completion rule

A task can only be marked DONE when receipts exist.
Never claim completion without observable artifacts.

---

## 7) Obligation Scan (lightweight, every heartbeat)

Goal: prevent broken promises without drowning the loop.

1. Check work-ledger.jsonl (if available): open commitments
2. Deadlines <48h → bump priority or execute immediately
3. Blocked items → attempt unblock or escalate with minimal ask

If work-ledger is unavailable:

- Do not claim it was checked; proceed with queue-driven execution.

---

## 8) Disconnect Investigation Protocol (ALARM)

Every disconnect is an alarm.

1. Check terminal output/logs for error text
2. Identify root cause category: timeout, missing file, network, memory pressure, permission, rate limit
3. Record learning (learnings.db if available; otherwise message Francisco with prevention)
4. Fix now if simple; otherwise create a task and continue

Common causes:

- Context truncation → save state more frequently
- Network timeout → backoff/retry
- Missing files → update references
- Memory pressure → monitor with `vm_stat` or `top -l 1` on macOS

---

## 9) Discussion Reply Check (every heartbeat if cheap; otherwise rotate)

If GitHub CLI is available, check for unanswered discussion comments:

```bash
# Check for unread discussion comments (if gh CLI available)
gh api repos/OWNER/REPO/discussions --jq '.[].comments' 2>/dev/null || echo "gh_unavailable"
```

If unanswered comments found:

- Respond in discussion + send Telegram note with [TaskID] prefix

If the check is slow, rotate it (Section 10).

---

## 10) Rotation Checks (2–4x daily, not every heartbeat)

Run these on a rotation schedule to avoid heartbeat overload:

- Memory integrity: verify `workspace/memory/tasks.json` parses and all lane refs are valid
- Backlog generator verification (daily 6 AM job exists; heartbeat only confirms output file exists)
- AI research brief supplement (light scan if no research done today)
- Git hygiene: check uncommitted changes; commit/push only if allowed by policy

Rule:

- If rotating checks are unavailable, do not claim they ran.

---

## 11) Complete Requests (Verification Queue)

Check `memory/complete-requests/` for pending verification files (e.g., `T006.json`):

1. Verify the work is actually complete (receipts/system check)
2. If complete: move to done_today in tasks.json + delete request file
3. If not complete: message Francisco with what's missing + delete request file

This is how Mission Control "Mark Complete" works: it requests verification; you verify.

---

## 12) Dashboard Discipline (when runtime supports it)

- Update current-task.json when starting/finishing tasks
- Update team.json status when dispatching/completing work
- Include: description, benefit, progress, steps, strategy
- If files are unavailable: do not claim updates; report BLOCKER.

---
