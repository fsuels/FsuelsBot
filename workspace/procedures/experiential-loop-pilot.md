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
