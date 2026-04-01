# Reflection Loop Protocol (Self-Correction)

**Created:** 2026-02-06
**Updated:** 2026-03-31 — 5-dimension scoring system + marginal improvement gate
**Status:** ACTIVE - implements Andrew Ng's Reflection pattern
**Authority:** SOUL.md Section 9 (Self-Reliance)

---

## The Gap We're Closing

**Current (peer review only):**

```
Do work → Submit for review → Reviewer finds errors → Fix → Re-submit
```

**New (reflection + peer review):**

```
Do work → Self-evaluate → Fix my own errors → Submit for review → Done
```

**Benefit:** Faster, more reliable, fewer round trips, less supervision needed.

---

## When to Use Reflection

**MANDATORY for:**

- Code changes (any edit/write to code files)
- Task completions (before marking done)
- External actions (emails, posts, messages)
- Complex multi-step work (Plan Mode tasks)

**OPTIONAL for:**

- Simple file reads
- Status checks
- Research notes

---

## The Reflection Loop (Step-by-Step)

### 1. DO THE WORK

Execute the task normally. Produce the artifact (code, text, analysis, etc.).

### 2. SELF-EVALUATE (Mandatory Questions)

**Quality Check:**

- [ ] Does this actually solve the problem?
- [ ] Is the logic sound? (No fallacies, no assumptions)
- [ ] Is the evidence sufficient?
- [ ] Did I verify it works? (Run test, check output, screenshot, etc.)

**Completeness Check:**

- [ ] Did I miss any requirements?
- [ ] Are there edge cases I didn't handle?
- [ ] Is documentation complete?

**Error Detection:**

- [ ] Could this break something?
- [ ] Are there obvious bugs?
- [ ] Did I introduce security issues?

**Transparency Check:**

- [ ] Can I explain my reasoning clearly?
- [ ] Am I certain, or guessing?
- [ ] Did I document what I don't know?

### 3. SCORE YOUR WORK (5-Dimension System)

Score each dimension independently on a 0-10 scale. **All dimensions must meet their individual threshold — no averaging, no compensation.**

| #   | Dimension            | What It Measures                                                                   | Threshold |
| --- | -------------------- | ---------------------------------------------------------------------------------- | --------- |
| 1   | **Completeness**     | Did it do everything asked? All requirements met, no gaps.                         | >=8       |
| 2   | **Accuracy**         | Are factual claims verified? No logical fallacies, no unsupported generalizations. | >=7       |
| 3   | **Evidence Quality** | Sources cited, confidence tagged, uncertainty disclosed.                           | >=7       |
| 4   | **Actionability**    | Are next steps concrete? Can the user act on this without follow-up questions?     | >=6       |
| 5   | **Format/Delivery**  | Correct format, right channel, matches requested structure.                        | >=6       |

**Pass condition:**

```
PASS = (Completeness >= 8)
    AND (Accuracy >= 7)
    AND (Evidence Quality >= 7)
    AND (Actionability >= 6)
    AND (Format/Delivery >= 6)
```

A 10 in Completeness does NOT compensate for a 5 in Accuracy. Every dimension must pass independently.

**If any dimension is below threshold:** Go to Step 4 (Iterate)
**If all dimensions pass:** Go to Step 5 (Submit)

### 4. ITERATE (Self-Correction + Marginal Improvement Gate)

For each failing dimension:

1. Fix the issue targeting that specific dimension
2. Verify the fix worked
3. Re-score all 5 dimensions

**Marginal Improvement Gate (replaces flat "max 3" rule):**

```
ITERATION RULES:
1. After iteration 1: if NO dimension improved by >= 1 point → ESCALATE immediately.
2. After iteration 2: if still not PASS AND no dimension improved by >= 1 point
   since iteration 1 → ESCALATE.
3. Hard cap: 3 iterations maximum, regardless of improvement.
```

**Rationale:** If iteration 1 produces zero improvement across all 5 dimensions, the agent is stuck on something it cannot self-correct. Further iterations waste time — escalate instead.

**Escalation protocol when triggered:**

1. Log a Reflection Failure Record (see below).
2. Set task status to `blocked` (not `failed`).
3. Include in escalation: which dimensions are failing, what was tried, what specific help is needed.
4. If Telegram is available, send a concise blocked-task summary to the user.

### 5. SUBMIT FOR PEER REVIEW

Now that you've self-corrected:

- Set task `status = "pending_review"`
- Spawn Reviewer sub-agent (see `peer-review.md`)
- Include your self-evaluation notes

---

## Reflection Template (Use This)

```markdown
## Reflection: [Task ID / Work Description]

### Work Completed:

[What I did]

### Dimensional Self-Evaluation:

| Dimension        | Score (0-10) | Threshold | Pass? | Notes |
| ---------------- | :----------: | :-------: | :---: | ----- |
| Completeness     |      \_      |    >=8    |       |       |
| Accuracy         |      \_      |    >=7    |       |       |
| Evidence Quality |      \_      |    >=7    |       |       |
| Actionability    |      \_      |    >=6    |       |       |
| Format/Delivery  |      \_      |    >=6    |       |       |

**Overall:** PASS / FAIL (all dimensions must pass)

### Failing Dimensions (if any):

- [Dimension]: [Score] — [What's wrong] — [Fix plan]

### Iterations:

- Iteration 1: [Dimension] [old score] -> [new score] — [What changed]
- Iteration 2: [Dimension] [old score] -> [new score] — [What changed]

### Final Status:

[Ready for peer review / Blocked on X / Needs human decision on Y]
```

---

## Reflection Failure Record (Use When Escalating)

```markdown
## Reflection Failure Record

- Task: [task_id]
- Failing Dimension(s): [accuracy, evidence_quality, ...]
- Self-Score(s): [accuracy: 5, evidence_quality: 4]
- Root Cause Category:
  - [ ] Overgeneralization (claimed broad truth from narrow evidence)
  - [ ] Missing verification (no test/screenshot/proof)
  - [ ] Incomplete requirements (missed part of the ask)
  - [ ] Source quality gap (used outdated/unreliable source)
  - [ ] Scope creep (answered more than asked, introduced error)
  - [ ] Other: [describe]
- Fix Applied: [what changed]
- Post-Fix Score: [new dimensional scores]
- Lesson (if pattern repeats >= 2x): [promote to procedure]
```

---

## Calibration Log

Every task that goes through reflection should produce a calibration record at:

**`workspace/memory/reflection-calibration-log.jsonl`**

Record format:

```jsonl
{
  "task_id": "example-task-2026-03-31",
  "timestamp": "2026-03-31T12:00:00Z",
  "self_scores": {
    "completeness": 8,
    "accuracy": 7,
    "evidence_quality": 6,
    "actionability": 7,
    "format": 8
  },
  "self_pass": false,
  "iterations": 1,
  "external_reviewer": "grok",
  "external_pass": false,
  "external_violations": [
    "hasty_generalization"
  ],
  "delta": {
    "completeness": 0,
    "accuracy": -3,
    "evidence_quality": -2,
    "actionability": 0,
    "format": 0
  },
  "notes": "Self-scored accuracy 7 but external found overgeneralization"
}
```

The `delta` field is `self_score - external_implied_score` per dimension. After 10 records, review mean deltas — if any dimension shows chronic over-scoring (mean delta > +1.5), raise its threshold by 1. Review cycle: every 10 tasks or 14 days, whichever comes first.

---

## Examples

### Example 1: Code Change (Reflection catches bug)

**Work:** Added new endpoint `/api/tasks`

**Dimensional Self-Evaluation:**

| Dimension        | Score | Threshold | Pass? | Notes                    |
| ---------------- | :---: | :-------: | :---: | ------------------------ |
| Completeness     |   7   |    >=8    |  NO   | Missing input validation |
| Accuracy         |   8   |    >=7    |  YES  | Logic correct            |
| Evidence Quality |   7   |    >=7    |  YES  | Tested happy path        |
| Actionability    |   7   |    >=6    |  YES  |                          |
| Format/Delivery  |   8   |    >=6    |  YES  |                          |

**Overall:** FAIL (Completeness below threshold)

**Iteration 1:**

- Added try/catch + 400 response for invalid JSON
- Added schema validation
- Completeness: 7 -> 9 (improved by 2 — gate passed)

**Final:** All dimensions pass. Ready for peer review.

---

### Example 2: Task Completion (Reflection prevents false claim)

**Work:** "Fixed Google Merchant Center logos"

**Dimensional Self-Evaluation:**

| Dimension        | Score | Threshold | Pass? | Notes                                    |
| ---------------- | :---: | :-------: | :---: | ---------------------------------------- |
| Completeness     |   6   |    >=8    |  NO   | No screenshot proof                      |
| Accuracy         |   5   |    >=7    |  NO   | Claiming completion without verification |
| Evidence Quality |   4   |    >=7    |  NO   | No receipts                              |
| Actionability    |   7   |    >=6    |  YES  |                                          |
| Format/Delivery  |   8   |    >=6    |  YES  |                                          |

**Overall:** FAIL (3 dimensions below threshold)

**Iteration 1:**

- Took screenshot of live site, verified logos show correctly
- Completeness: 6 -> 9, Accuracy: 5 -> 9, Evidence Quality: 4 -> 9
- All improved by >= 1 point — marginal improvement gate cleared

**Final:** All dimensions pass. Ready for peer review with screenshot evidence.

---

## Integration with Existing Protocols

**Reflection runs BEFORE peer review:**

```
Plan → Execute → Reflect → Peer Review → Done
```

**Reflection is part of Verification Gate:**

- Old: Provide evidence → Get peer review
- New: Provide evidence → Self-evaluate (5 dimensions) → Fix issues → Get peer review

**ERL-lite pilot integration (2026-02-17):**

- For first-attempt failures, run one guided retry using a structured Reflection Block.
- Promote lessons to durable procedure only after >=2 successful repeats.
- See `procedures/experiential-loop-pilot.md` for pilot KPIs and rollout guardrails.

---

## Self-Correction Motto

```
BEFORE submitting ANY work:
    ↓
REFLECT on all 5 dimensions
DETECT which dimensions are below threshold
FIX the specific failing dimensions
CHECK marginal improvement gate before iterating again
    ↓
THEN ask for review
```

---

## Failure Modes (Anti-Patterns)

❌ **Skipping reflection** - "I'll just submit and let review catch it"
✅ **Correct:** Always reflect, even on simple tasks

❌ **Single-score collapse** - Averaging good dimensions to hide a failing one
✅ **Correct:** All 5 dimensions must independently meet their thresholds

❌ **Infinite iteration with no progress** - Stuck in loop with no dimension improving
✅ **Correct:** Marginal improvement gate — if iteration 1 improves nothing, escalate immediately

❌ **Self-approval without evidence** - "Looks good to me"
✅ **Correct:** Verify with receipts (test output, screenshot, etc.)

❌ **Hiding uncertainty** - Claiming certainty when guessing
✅ **Correct:** Explicit about "I'm certain" vs "I think" vs "I don't know"

---

## Maintenance

**Review this protocol:**

- After any task where reflection caught an error (update examples)
- Monthly (ensure it's still serving self-reliance goal)
- When Francisco gives feedback on quality issues
- After every 10 calibration log records (auto-adjustment review)

**Success metrics:**

- Peer review rejection rate should decrease over time
- Self-correction should catch >80% of issues before review
- Calibration log delta should trend toward zero per dimension over time
- False positive rate (self-pass but external-fail) target: <25% per dimension
