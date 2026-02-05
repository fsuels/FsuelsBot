# HEARTBEAT.md — Control Loop (Proactive, Non-Stop Execution)
_Last reviewed: 2026-02-04_

Purpose: The heartbeat is a fast control loop that keeps the system safe, truthful, and continuously executing tasks. It must be resilient to partial tool failure and must never claim actions without receipts.

---

## 0) Epistemic Health Check (FIRST — every heartbeat)
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
Run the combined script once per heartbeat:

```powershell
powershell -ExecutionPolicy Bypass -File "C:\dev\FsuelsBot\workspace\scripts\heartbeat-checks.ps1" -Quiet
```

Receipts rule:
- Treat the returned JSON as the only source of truth for what happened.
- If the script errors or returns invalid JSON: record the error and continue with minimal safe mode (Section 5).

Expected output (example):
`{"healthState":"updated","missionControl":"running",...}`

---

## 3) Tasks.json Integrity Gate (BEFORE ANY WRITE)
Before ANY modification to tasks.json, validate integrity:

```powershell
powershell -ExecutionPolicy Bypass -File "scripts\validate-tasks-integrity.ps1"
```

Rules:
- If validation fails: **DO NOT WRITE** to tasks.json.
- Immediately notify Francisco with the error output + suspected root cause.
- Move any work that requires tasks.json writes into WAITING_HUMAN.

Root cause record (2026-02-01):
- Lane arrays referenced task IDs without definitions = corruption.

---

## 4) Mission Control / Infra Checks (Capability-Gated)
Mission Control is critical, but do not claim it’s running unless you have receipts.

- Prefer to trust `heartbeat-checks.ps1` output for Mission Control status.
- If port 8765 is down and the runtime supports restart:
  - `Start-ScheduledTask -TaskName "MissionControlServer"`
- If a restart occurred AND Telegram send is available:
  - Send Francisco the mobile URL.

Dashboard URLs:
- PC: `http://localhost:8765`
- Mobile (WiFi): `http://192.168.4.25:8765?key=a6132abf77194fd10a77317a094771f1`

Receipts rule:
- If you cannot confirm restart + send, report BLOCKER instead of claiming completion.

---

## 5) Minimal Safe Mode (when scripts/tools fail)
If Tier-0 checks fail (PowerShell blocked, script missing, JSON invalid):
1) Do not write to tasks.json
2) Do not claim infra status
3) Continue task execution only for tasks that do not require:
   - browser automation
   - external sends
   - destructive ops
   - state persistence writes
4) Report one-line blocker:
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
- Move task to WAITING_HUMAN (“human column”)
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

1) Check work-ledger.jsonl (if available): open commitments
2) Deadlines <48h → bump priority or execute immediately
3) Blocked items → attempt unblock or escalate with minimal ask

If work-ledger is unavailable:
- Do not claim it was checked; proceed with queue-driven execution.

---

## 8) Disconnect Investigation Protocol (ALARM)
Every disconnect is an alarm.

1) Check terminal output/logs for error text
2) Identify root cause category: timeout, missing file, network, memory pressure, permission, rate limit
3) Record learning (learnings.db if available; otherwise message Francisco with prevention)
4) Fix now if simple; otherwise create a task and continue

Common causes:
- Context truncation → save state more frequently
- Network timeout → backoff/retry
- Missing files → update references
- Memory pressure → monitor WorkingSet64 (if available)

---

## 9) Discussion Reply Check (every heartbeat if cheap; otherwise rotate)
If available and fast, run:

```powershell
powershell -ExecutionPolicy Bypass -File "C:\dev\FsuelsBot\workspace\scripts\check-discussion-comments.ps1" -Quiet
```

If unanswered comments found:
- Respond in discussion + send Telegram note with [TaskID] prefix

If the script is slow, rotate it (Section 10).

---

## 10) Rotation Checks (2–4x daily, not every heartbeat)
Run these on a rotation schedule to avoid heartbeat overload:

- Memory integrity validator:
  ```powershell
  powershell -ExecutionPolicy Bypass -File "C:\dev\FsuelsBot\workspace\tests\validators\memory-integrity.ps1"
  ```
- Backlog generator verification (daily 6 AM job exists; heartbeat only confirms output file exists)
- AI research brief supplement (light scan if no research done today)
- Git hygiene: check uncommitted changes; commit/push only if allowed by policy

Rule:
- If rotating checks are unavailable, do not claim they ran.

---

## 11) Complete Requests (Verification Queue)
Check `memory/complete-requests/` for pending verification files (e.g., `T006.json`):
1) Verify the work is actually complete (receipts/system check)
2) If complete: move to done_today in tasks.json + delete request file
3) If not complete: message Francisco with what’s missing + delete request file

This is how Mission Control “Mark Complete” works: it requests verification; you verify.

---

## 12) Dashboard Discipline (when runtime supports it)
- Update current-task.json when starting/finishing tasks
- Update team.json status when dispatching/completing work
- Include: description, benefit, progress, steps, strategy
- If files are unavailable: do not claim updates; report BLOCKER.

---
