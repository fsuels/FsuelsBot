---
updated: 2026-02-01
version: "1.0"
confidence: high
type: procedure
---

# 🔍 Peer Review System

> **Trigger:** Before ANY task moves to `done_today`
> **Rule:** No completion without independent reviewer approval
> **Purpose:** Catch self-deception, missing evidence, obvious errors

## 🧭 THE MOTTO (Applies to EVERY review)

```
EVERY completion claim
        ↓
   INDEPENDENT VERIFICATION
   EVIDENCE CONFIRMATION
   ERROR DETECTION
```

---

## WHEN DOES PEER REVIEW TRIGGER?

Peer review is **MANDATORY** when:
1. Moving any task from `bot_current` → `done_today`
2. Marking any step as "done" in a multi-step task
3. Any task with `epistemic.verification_status != "human_verified"`

Peer review is **SKIPPED** when:
- Francisco explicitly marks task done (human verification = trusted)
- Task has `peer_review.skip: true` (only Francisco can set this)
- Task is purely administrative (CRON logs, etc.)

---

## THE REVIEW PROCESS

### Step 1: Pre-Review Checklist (Before spawning reviewer)

Before requesting peer review, the completing agent MUST have:
```
□ epistemic.claims[] populated (what was done)
□ epistemic.verified[] populated (evidence)
□ All claimed artifacts exist (files, changes, outputs)
□ Task status set to "pending_review" (NOT "done")
```

### Step 2: Spawn Reviewer Sub-Agent

Use this exact prompt template:

```
PEER REVIEW REQUEST

TASK: [Task ID and title]
CLAIMED WORK:
[List from epistemic.claims[]]

EVIDENCE PROVIDED:
[List from epistemic.verified[]]

ARTIFACTS TO CHECK:
[List file paths, URLs, or other tangible outputs]

YOUR JOB AS REVIEWER:
1. EVIDENCE CHECK — Does evidence actually exist? (Read the files, check the paths)
2. CLAIM MATCH — Does evidence support ALL claims? (Not just some)
3. ERROR SCAN — Any obvious bugs, typos, broken logic?
4. COMPLETENESS — Is the task actually done, or just started?

RESPOND WITH ONE OF:
✅ APPROVED — All checks passed [brief reason]
❌ REJECTED — [specific failure and what to fix]

Be STRICT. If in doubt, REJECT. Self-deception is the enemy.
```

### Step 3: Reviewer Executes Checks

The reviewer sub-agent MUST:

**A. Evidence Existence Check**
```
For each item in epistemic.verified[]:
  - If file path → Read file, confirm it exists and has expected content
  - If URL → Fetch URL, confirm accessible
  - If test output → Check if test actually ran
  - If screenshot → Confirm screenshot exists at path
```

**B. Claim-Evidence Match**
```
For each item in epistemic.claims[]:
  - Find corresponding evidence in verified[]
  - If no evidence for a claim → REJECT
  - If evidence is weak/unclear → REJECT
```

**C. Error Scan**
```
Quick checks for obvious issues:
  - Syntax errors in code
  - Broken links in docs
  - Incorrect file paths
  - Typos in important fields
  - Logic gaps in implementations
```

**D. Completeness Check**
```
Read the task's original goal (title + approach + steps).
Ask: "Is this actually DONE, or just STARTED?"
Partial completion → REJECT with "needs steps X, Y, Z"
```

### Step 4: Record Review Result

Add to task in tasks.json:
```json
"peer_review": {
  "status": "approved" | "rejected",
  "reviewer": "subagent:peer-review-XXXX",
  "reviewed_at": "2026-02-01T05:00:00Z",
  "reason": "All evidence verified, code syntax checked, files exist",
  "evidence_checked": [
    "procedures/peer-review.md exists ✓",
    "AGENTS.md updated ✓"
  ],
  "issues_found": []  // or list of issues if rejected
}
```

### Step 5: Handle Result

**If APPROVED:**
1. Update task status to "done"
2. Move to `done_today` lane
3. Log completion to events.jsonl

**If REJECTED:**
1. Keep task in `bot_current`
2. Add rejection reason to task notes
3. Fix the identified issues
4. Re-request peer review after fixes

---

## REVIEWER INDEPENDENCE RULES

**The reviewer MUST be independent:**
- ❌ Same sub-agent cannot review its own work
- ❌ Main agent cannot mark its own work approved without spawning reviewer
- ✅ Sub-agent spawned specifically for review is independent
- ✅ Different session = independent

**Why this matters:**
Same AI reviewing same work = same blind spots. A fresh sub-agent gets:
- Fresh context (not invested in the work)
- Skeptical stance (told to be strict)
- Different failure modes (independent session)

---

## QUICK REFERENCE: REVIEW STATUSES

| Status | Meaning | Next Action |
|--------|---------|-------------|
| `pending_review` | Work done, awaiting review | Spawn reviewer |
| `approved` | Reviewer verified | Move to done_today |
| `rejected` | Reviewer found issues | Fix and re-submit |
| `skipped` | Human verified or admin task | Move to done_today |

---

## INTEGRATION WITH EXISTING TASK FLOW

### Updated Task Completion Flow:

```
1. Do the work
2. Populate epistemic.claims[] and epistemic.verified[]
3. Set status = "pending_review"
4. Spawn Reviewer sub-agent
5. Wait for APPROVED/REJECTED
6. If APPROVED → status = "done", move to done_today
7. If REJECTED → fix issues, go to step 4
```

### Tasks.json Schema Addition:

```json
{
  "T123": {
    "title": "Example task",
    "status": "pending_review",  // NEW: intermediate status
    "epistemic": {
      "claims": [...],
      "verified": [...],
      "verification_status": "evidence_provided"
    },
    "peer_review": {  // NEW: review tracking
      "status": "pending" | "approved" | "rejected" | "skipped",
      "reviewer": "subagent:peer-review-XXX",
      "reviewed_at": "ISO timestamp",
      "reason": "Why approved/rejected",
      "evidence_checked": ["list of verified items"],
      "issues_found": ["list of problems if rejected"],
      "attempts": 1  // Track review attempts
    }
  }
}
```

---

## EXCEPTIONS (When to Skip)

Peer review can be skipped ONLY when:

1. **Human Verified** — Francisco explicitly confirmed task done
   - Set `peer_review.status = "skipped"` with reason "human_verified"

2. **Administrative Tasks** — Pure logging/bookkeeping
   - CRON status updates
   - Memory/state file updates
   - Index rebuilds
   - Set `peer_review.skip = true` on task creation

3. **Emergencies** — Francisco explicitly says "skip review"
   - Must be explicit in chat
   - Log the skip with timestamp

---

## ANTI-PATTERNS (What NOT to do)

❌ **Self-Approving:** "I reviewed my work and it looks good" — INVALID
❌ **Soft Rejection:** "Mostly good, minor issues" → This is a REJECTION
❌ **Evidence Theater:** Listing evidence without actually checking it
❌ **Rushing:** Approving without reading files/checking paths
❌ **Scope Creep:** Reviewer adding new requirements not in original task

---

## METRICS TO TRACK

Add to weekly CI report:
- `peer_review_approval_rate` — What % of tasks pass first review?
- `common_rejection_reasons` — What fails most often?
- `reviews_per_task` — How many attempts before approval?

Target: >80% first-time approval rate (means claims are accurate)
Red flag: <50% approval rate (means systematic self-deception)

---

## REVIEWER PROMPT (Copy-Paste Ready)

```
PEER REVIEW: Independent Verification

TASK: {task_id} - {task_title}

CLAIMS MADE:
{list epistemic.claims}

EVIDENCE PROVIDED:
{list epistemic.verified}

ARTIFACTS:
{list file paths, URLs}

YOUR REVIEW CHECKLIST:
1. [ ] Each evidence item actually exists (read the files!)
2. [ ] Evidence supports ALL claims (not partial)
3. [ ] No obvious errors (syntax, typos, broken links)
4. [ ] Task is actually complete (not just started)

RESPOND:
✅ APPROVED — [reason, what you checked]
❌ REJECTED — [specific issue, how to fix]

BE STRICT. Better to reject good work than approve bad work.
Self-deception is the enemy. If unsure, REJECT.
```

---

## ENFORCEMENT

This procedure is enforced by:
1. **Task status check** — Tasks cannot move to done_today if status = "pending_review"
2. **Lane validation** — done_today requires peer_review.status = "approved" or "skipped"
3. **Heartbeat audit** — Report tasks stuck in pending_review > 1 hour
4. **Weekly CI** — Flag tasks completed without peer_review field

---

## CHANGELOG

- **v1.0 (2026-02-01):** Initial implementation
  - Mandatory peer review for all bot task completions
  - Independent reviewer sub-agent requirement
  - Integration with existing epistemic tracking
