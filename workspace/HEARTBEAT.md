# HEARTBEAT.md — Control Loop

_Last reviewed: 2026-03-31_

The heartbeat dispatches tasks and keeps infrastructure healthy. It must never claim actions without receipts.

**Epistemic discipline and the Motto apply here (see SOUL.md). Not repeated.**

---

## 0) Auto-Continue (ABSOLUTE FIRST)

Check `bot_current` in `workspace/memory/tasks.json`:

- **Has tasks →** Execute first task immediately. Skip all checks below. After completion, check for more tasks before running any heartbeat overhead.
- **Empty →** Run full heartbeat checks (Sections 1-7).
- **Staleness guard:** If same task has been IN_PROGRESS >2 hours with no progress, flag it and consider WAITING_HUMAN.
- **Infrastructure guard:** Every 5th consecutive task-execution heartbeat, run Tier-0 checks anyway.

### 0.1) Loop-Prevention Gate (MANDATORY)

When a heartbeat prompt is received and `bot_current` is non-empty:

1. **Do execution, not status repetition.** Complete at least one concrete task slice (<=1-3 tool calls or <=5 minutes) and produce a receipt (diff/output/log line).
2. **No repeated alert-only replies.** Never return the same "heartbeat not idle" status twice in a row without either (a) new execution receipt, or (b) a blocker transition.
3. **If blocked, transition state.** Move the task to `WAITING_HUMAN` with minimum needed input (1 question, 2 options), then report blocker once.
4. **`HEARTBEAT_OK` is allowed only when no actionable heartbeat work remains.**

---

## 1) Time Budget

Heartbeat overhead: **<= 90 seconds.** If exceeded, stop overhead and return to task execution.

---

## 2) Tier-0 Checks (every idle heartbeat)

```bash
# tasks.json parseable?
python3 -c "import json; json.load(open('workspace/memory/tasks.json'))" 2>&1
# Mission Control reachable?
curl -s -o /dev/null -w '%{http_code}' http://localhost:8765/ 2>/dev/null || echo "mc_down"
# Gateway alive?
launchctl list bot.molt.gateway 2>/dev/null | head -1 || echo "gateway_unknown"
```

If checks error → record error, enter Minimal Safe Mode (Section 6).

## 2.1) Plan Mode Policy Integrity (idle heartbeat)

```bash
python3 -c "import json; p=json.load(open('workspace/procedures/plan-mode-policy.json')); assert p.get('defaultMode')=='plan'; assert p.get('failClosed') is True; print('PLAN_MODE_POLICY_OK')" 2>&1
```

If this check fails: report BLOCKER and fail closed to Plan Mode behavior.

---

## 3) tasks.json Integrity Gate (before any write)

```bash
python3 -c "
import json, sys
d = json.load(open('workspace/memory/tasks.json'))
ids = set(d.get('tasks', {}).keys())
for lane, refs in d.get('lanes', {}).items():
    for r in refs:
        if r not in ids:
            print(f'ORPHAN: {lane}/{r}'); sys.exit(1)
print('OK')
"
```

If validation fails: **do not write**, notify Francisco with error + suspected cause, move work to WAITING_HUMAN.

---

## 4) Mission Control (capability-gated)

- Check `curl -s http://localhost:8765/`. If down and restart is possible, restart.
- If restarted + Telegram available → send Francisco mobile URL: `http://192.168.4.25:8765?key=a6132abf77194fd10a77317a094771f1`
- If restart unconfirmed → report BLOCKER.

---

## 5) Task Runner (PRIMARY PURPOSE)

### State machine

- **Runnable:** NEW, IN_PROGRESS → execute
- **Non-runnable:** WAITING_HUMAN, WAITING_EXTERNAL, DONE, FAILED → skip

### Blocker handling

- Human-blocked → move to WAITING_HUMAN, record minimum needed input (1-3 items + one question + two options), notify Francisco, continue next task.
- Rate-limit/vendor-blocked → WAITING_EXTERNAL with retry/backoff note, continue.

### Execution discipline

- <= 1-3 tool calls OR ~5 min per task slice before yielding.
- Always write receipts (diff, output, screenshot ref, log line).
- Task is DONE only when receipts exist (see `procedures/task-completion.md`).
- Update current-task.json and team.json when starting/finishing tasks.

---

## 6) Minimal Safe Mode (when checks/tools fail)

1. Do not write to tasks.json
2. Do not claim infra status
3. Continue only tasks not requiring browser, external sends, destructive ops, or state writes
4. Report: `BLOCKER: heartbeat checks unavailable ([error]) — safe tasks only`

---

## 7) Periodic Checks

### Every heartbeat (lightweight)

- **Obligation scan:** Check work-ledger.jsonl for open commitments. Deadlines <48h → bump priority or execute. If ledger unavailable, do not claim it was checked.
- **Complete requests:** Check `memory/complete-requests/` for pending verification files. Verify work → move to done_today or notify Francisco what's missing.

### Rotation (2-4x daily, not every heartbeat)

- tasks.json structural integrity (lane refs valid)
- Backlog generator output file exists
- Light AI research scan if none done today
- Git hygiene: uncommitted changes check
- GitHub discussion replies (if `gh` CLI available and fast)

If a rotation check is unavailable, do not claim it ran.

---

## 8) Disconnect Investigation

Every disconnect is an alarm:

1. Check logs for error text
2. Categorize: timeout | missing file | network | memory pressure | permission | rate limit
3. Record learning (learnings.db or message Francisco)
4. Fix if simple; otherwise create task and continue
