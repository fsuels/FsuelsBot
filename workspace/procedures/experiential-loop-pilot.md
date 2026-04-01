# Experiential Loop Pilot (ERL-Lite)

**Created:** 2026-02-17  
**Status:** ACTIVE (7-day pilot)  
**Goal:** Reduce repeat failures and speed up second-attempt success without adding heavy training infrastructure.

---

## Scope

Apply to a limited pilot set of tasks (10-20 tasks max).

**Included:**

- Tasks that fail on first attempt
- Multi-step tasks with clear acceptance criteria

**Excluded:**

- One-shot low-risk reads/status checks
- Tasks blocked by missing external access

---

## Core Loop (Operational Adaptation)

1. **Attempt #1**
   - Execute task normally.
   - Capture receipts/evidence.

2. **Reflection Block (Required on failure)**
   - Record exactly:
     - Failure mode (what failed)
     - Root cause hypothesis (why)
     - Fix plan (what changes now)
     - Safety guard (how to avoid blast radius)

3. **Attempt #2 (Guided Retry)**
   - Retry once using the reflection block.
   - Verify against acceptance criteria.

4. **Consolidation Gate**
   - If successful, save reusable lesson.
   - Promote to durable procedure only when pattern repeats successfully >=2 times.

---

## Reflection Block Template

```markdown
## Reflection Block

- Task:
- Attempt #: 1
- Failed Step:
- Observed Failure:
- Root Cause (hypothesis):
- Fix for Retry:
- Safety Guard:
- Expected Signal of Success:
```

---

## KPI Checklist (7 Days)

Track these metrics daily.

**Auto-log location:** `workspace/memory/erl-lite-kpi-log.md`

Track these metrics daily:

1. **Second-attempt success rate**  
   `successful second attempts / total reflected retries`

2. **Repeat-failure rate**  
   `tasks with same failure recurring / total pilot tasks`

3. **Time-to-recovery**  
   `time from failure detection to verified fix`

4. **Promoted lessons count**  
   Number of lessons promoted to procedure/memory after >=2 successful repeats.

---

## Success Criteria

Pilot is considered successful if all are true:

- Second-attempt success rate improves vs baseline.
- Repeat-failure rate decreases.
- No major safety incidents from retries.
- At least 3 durable lessons promoted with evidence.

---

## Daily Logging Rule

- Update `workspace/memory/erl-lite-kpi-log.md` once per day (end-of-day).
- If a metric is unavailable, record `TBD` and include why in Notes.
- Keep entries additive (never rewrite prior days except to correct clear factual errors).

## Guardrails

- Max **one guided retry** before escalation.
- No autonomous broad policy rewrites from a single success.
- Keep all changes reversible.
- Prefer narrow rollout before global rollout.

---

## Error Log Integration (Applied 2026-03-31)

When a REFLECTION BLOCK captures a failure, also append to `workspace/memory/error-log.jsonl` using this format:

```json
{
  "error_id": "ERR-{YYYY-MM-DD}-{NNN}",
  "timestamp": "ISO-8601",
  "failure_mode": "short canonical description of what failed",
  "root_cause": "hypothesis for why it failed",
  "context": {
    "task_id": "T-123 or null",
    "tool": "exec | browser | peekaboo | git | etc.",
    "skill": "browser-automation | powershell-ops | memory-ops | etc.",
    "file": "path if relevant or null"
  },
  "fix_applied": "what was done to resolve it",
  "fix_worked": true,
  "severity": "low | medium | high | critical",
  "tags": ["array", "of", "keywords"],
  "source": "reflection-block | daily-memory | human-correction | heartbeat"
}
```

**Rules:**

- `error_id`: `ERR-{YYYY-MM-DD}-{NNN}` where NNN is a zero-padded daily sequence number (e.g. `ERR-2026-03-31-001`).
- `failure_mode`: Keep short and reusable — consistent phrasing enables pattern matching (e.g. "PowerShell chained commands fail" not "the && thing broke again").
- `fix_worked`: Set `false` if fix was attempted but error persisted. The same error can appear twice (once `false`, once `true`) if a second fix succeeded.
- Append one line per error — the file is append-only.

**Pattern thresholds:**

| Occurrences | Status     | Action                                            |
| ----------- | ---------- | ------------------------------------------------- |
| 2           | `watch`    | Log pattern ID in daily memory, no further action |
| 3           | `act`      | Create investigation task in bot_queue / backlog  |
| 5           | `escalate` | Telegram alert + flag for human attention         |

Pattern grouping: two entries belong to the same pattern if their `failure_mode` strings have normalized similarity >= 0.7, OR they share >= 2 tags AND the same `context.tool`.
