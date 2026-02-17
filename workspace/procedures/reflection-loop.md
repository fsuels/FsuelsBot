# Reflection Loop Protocol (Self-Correction)

**Created:** 2026-02-06  
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

### 3. SCORE YOUR WORK
Use a simple 0-10 scale:
- **0-3:** Broken/incomplete - needs major rework
- **4-6:** Works but has issues - needs iteration
- **7-8:** Good quality - minor tweaks only
- **9-10:** Excellent - ready for peer review

**If score < 7:** Go to Step 4 (Iterate)  
**If score >= 7:** Go to Step 5 (Submit)

### 4. ITERATE (Self-Correction)
For each issue found in Step 2:
1. Fix the issue
2. Verify the fix worked
3. Re-run Step 2 (re-evaluate)

**Anti-Pattern:** Iterating >3 times on same issue = you're stuck  
**Correct Response:** Stop, document the blocker, ask for help

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

### Self-Evaluation:
**Quality:** [0-10 score] - [Reasoning]
**Completeness:** ✅/⚠️/❌ - [What's missing if not ✅]
**Error Detection:** [Issues found + fixes applied]
**Transparency:** [What I'm certain vs uncertain about]

### Iterations:
[If score < 7, list what I fixed]
- Iteration 1: [Issue] → [Fix] → [New score]
- Iteration 2: [Issue] → [Fix] → [New score]

### Final Status:
[Ready for peer review / Blocked on X / Needs human decision on Y]
```

---

## Examples

### Example 1: Code Change (Reflection catches bug)

**Work:** Added new endpoint `/api/tasks`

**Self-Evaluation:**
- Quality: 6/10 - Works but no error handling
- Completeness: ⚠️ - Missing input validation
- Error Detection: Found - endpoint crashes on invalid JSON
- Transparency: Certain about happy path, uncertain about edge cases

**Iteration 1:**
- Added try/catch + 400 response for invalid JSON
- Added schema validation
- Re-score: 8/10

**Final:** Ready for peer review

---

### Example 2: Task Completion (Reflection prevents false claim)

**Work:** "Fixed Google Merchant Center logos"

**Self-Evaluation:**
- Quality: 4/10 - I uploaded files but didn't verify they're live
- Completeness: ❌ - No screenshot proof
- Error Detection: Could be claiming completion without evidence
- Transparency: I'm GUESSING it worked - I didn't check

**Iteration 1:**
- Take screenshot of live site
- Verify logos show correctly
- Re-score: 9/10

**Final:** Ready for peer review with screenshot evidence

---

## Integration with Existing Protocols

**Reflection runs BEFORE peer review:**
```
Plan → Execute → Reflect → Peer Review → Done
```

**Reflection is part of Verification Gate:**
- Old: Provide evidence → Get peer review
- New: Provide evidence → Self-evaluate → Fix issues → Get peer review

**ERL-lite pilot integration (2026-02-17):**
- For first-attempt failures, run one guided retry using a structured Reflection Block.
- Promote lessons to durable procedure only after >=2 successful repeats.
- See `procedures/experiential-loop-pilot.md` for pilot KPIs and rollout guardrails.

---

## Self-Correction Motto

```
BEFORE submitting ANY work:
    ↓
REFLECT on quality
DETECT my own errors
FIX what I find
    ↓
THEN ask for review
```

---

## Failure Modes (Anti-Patterns)

❌ **Skipping reflection** - "I'll just submit and let review catch it"  
✅ **Correct:** Always reflect, even on simple tasks

❌ **Infinite iteration** - Stuck in loop trying to perfect  
✅ **Correct:** Max 3 iterations, then escalate

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

**Success metric:**
- Peer review rejection rate should decrease over time
- Self-correction should catch >80% of issues before review
