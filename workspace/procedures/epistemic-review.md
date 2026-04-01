# 🔍 Epistemic Review Procedure

**Cron Job:** CRON-epistemic-review
**Schedule:** 9 AM + 9 PM daily
**Purpose:** External AI review of bot actions for motto violations

## 🧭 THE STANDARD

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

---

## WHY EXTERNAL REVIEW?

**Blindspot Problem:** Same AI reviewing same AI's work = same biases.

**Solution:** Use external AIs with different training:

- **Gemini** — Google's model, different perspective
- **Grok** — X's model, adversarial by design
- **ChatGPT** — OpenAI's model, different failure modes

---

## REVIEW PROCESS

### Step 1: Extract Actions

Pull from memory files:

- `memory/YYYY-MM-DD.md` — raw session log
- `memory/tasks.json` — completed tasks
- `memory/active-thread.md` — recent conversation

### Step 2: Format Review Request

```
REVIEW REQUEST FOR EXTERNAL AI

I need you to review these AI actions against this standard:

EVERY response I give
EVERY analysis I make
EVERY recommendation I offer
EVERY claim I accept
EVERY action I take
        ↓
   SOUND LOGIC
 VERIFIED EVIDENCE
   NO FALLACIES

ACTIONS TO REVIEW:
[paste extracted actions]

FOR EACH ACTION, CHECK:
1. SOUND LOGIC — Is the reasoning valid? Any gaps?
2. VERIFIED EVIDENCE — Were claims verified? Or assumed?
3. NO FALLACIES — Detect any of these:
   - Ad Hominem (attacking person, not argument)
   - Bandwagon (popularity = truth)
   - False Cause (correlation = causation)
   - Appeal to Authority (credentials = correctness)
   - Hasty Generalization (small sample → big claim)
   - False Dilemma (only 2 options presented)
   - Straw Man (misrepresenting argument)

OUTPUT FORMAT:
For each violation found:
- ACTION: [what was done]
- VIOLATION: [which principle broken]
- FALLACY: [which fallacy, if any]
- EVIDENCE: [why this is a violation]
- FIX: [how to correct]

If no violations: "REVIEW PASSED — No violations detected."
```

### Step 3: Submit to External AIs

**Morning Review (9 AM):** Review yesterday's actions
**Evening Review (9 PM):** Review today's actions

Use rotation:

- Day 1: Gemini CLI
- Day 2: Grok (browser)
- Day 3: ChatGPT (browser)
- Repeat

Or use ALL THREE for critical reviews.

### Step 4: Log Findings

Append to `memory/epistemic-reviews.jsonl`:

```json
{
  "ts": "2026-01-31T21:00:00Z",
  "period": "2026-01-31-PM",
  "reviewer": "gemini",
  "violations_found": 2,
  "violations": [
    {
      "action": "Accepted X post claim without verification",
      "violation": "VERIFIED EVIDENCE",
      "fallacy": "Appeal to Authority",
      "fix": "Should have checked if 82% win rate claim had proof"
    }
  ],
  "passed": false
}
```

### Step 5: Alert + Correct

If violations found:

1. **Alert Francisco** via Telegram with summary
2. **Create correction task** in tasks.json
3. **Log to learnings.db** so we don't repeat

---

## GEMINI CLI COMMAND

```bash
gemini -p "REVIEW REQUEST FOR EXTERNAL AI

I need you to review these AI actions against this standard:

EVERY response I give
EVERY analysis I make
EVERY recommendation I offer
EVERY claim I accept
EVERY action I take → SOUND LOGIC, VERIFIED EVIDENCE, NO FALLACIES

ACTIONS TO REVIEW:
$(cat memory/2026-01-31.md | head -100)

Check for: Logic gaps, unverified claims, fallacies (Ad Hominem, Bandwagon, False Cause, Appeal to Authority, Hasty Generalization).

Output violations found or 'REVIEW PASSED' if none."
```

---

## REVIEW ROTATION

| Day | Morning (9 AM) | Evening (9 PM) |
| --- | -------------- | -------------- |
| Mon | Gemini         | Grok           |
| Tue | ChatGPT        | Gemini         |
| Wed | Grok           | ChatGPT        |
| Thu | Gemini         | Grok           |
| Fri | ChatGPT        | Gemini         |
| Sat | Grok           | ChatGPT        |
| Sun | ALL THREE      | Summary Report |

---

## SUCCESS CRITERIA

**Weekly Metrics:**

- Violations found: Track count
- Violations by type: Which principles broken most?
- Trend: Are we improving over time?
- False positives: Did external AI flag something incorrectly?

**Target:** <2 violations per week after first month.

---

## ACCOUNTABILITY

This cron job creates an EXTERNAL check on my work. I cannot mark it as "passed" — the external AI does. This prevents self-deception.

---

## Auto-Response Rules (Applied 2026-03-31)

Sourced from: `.autoresearch/outputs/06-epistemic-auto-response.md`

This section closes the gap between violation detection and correction by defining automated corrective actions the bot executes when epistemic reviews find problems.

---

### 1. Violation-to-Action Mapping

| #   | Violation Type                         | Corrective Action                                                                                                                                                                                                                                                                             | Confidence Tag After Fix                                   |
| --- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 1.1 | **Hasty Generalization**               | Add scope qualifier to the claim; create verification task to reproduce claim in specific context and at least one alternative context; if narrow scope confirmed, update source with qualified claim                                                                                         | `SCOPED` (was UNQUALIFIED)                                 |
| 1.2 | **False Cause**                        | Append `[CAUSAL-UNVERIFIED]` tag; require listing 2+ alternative hypotheses; create task to test proposed mechanism (isolate cause, remove it, check if effect persists); promote to `[CAUSAL-VERIFIED]` only when mechanism demonstrated, 2 alternatives ruled out, and test is reproducible | `CAUSAL-UNVERIFIED` until mechanism demonstrated           |
| 1.3 | **Insufficient Evidence**              | Downgrade confidence tag to `UNVERIFIED`; add entry to `memory/verification-queue.jsonl`; attempt automated verification during idle heartbeat cycles (re-fetch, re-test, re-query); escalate to human review after 3 failed attempts                                                         | `UNVERIFIED` (pending verification)                        |
| 1.4 | **Appeal to Authority**                | Tag claim as `[AUTHORITY-ONLY]`; create verification task requiring at least one independent corroborating source or reproducible test; block claim from external actions until independently verified; if verification contradicts, flag as `DISPUTED`                                       | `AUTHORITY-ONLY` until independently verified              |
| 1.5 | **Proof by Assertion**                 | Tag claim as `[ASSERTED-UNVERIFIED]`; create task requiring observable evidence (test result, screenshot, data point, or primary source citation); if no evidence within severity window, downgrade to `RETRACTED`; prevent propagation to procedures or knowledge base                       | `ASSERTED-UNVERIFIED` until evidence produced              |
| 1.6 | **Circular Reasoning**                 | Flag and tag as `[CIRCULAR-FLAGGED]`; create reformulation task to restate argument with independent premises; if cannot be reformulated, mark as `UNSUPPORTED` and remove from active knowledge base; log original circular structure for pattern tracking                                   | `CIRCULAR-FLAGGED` until reformulated                      |
| 1.7 | **Cherry Picking / Survivorship Bias** | Tag as `[PARTIAL-EVIDENCE]`; create task to search for contradicting evidence or failure cases; if contradicting evidence found, update claim to include it and adjust conclusion; if no contradicting evidence found after reasonable search, promote to `VERIFIED-COMPREHENSIVE`            | `PARTIAL-EVIDENCE` until counter-evidence search completed |

---

### 2. Severity Scoring

| Severity     | Criteria                                                                                          | Deadline                                        | Auto-fix?                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------- |
| **Critical** | Claim used for external actions: customer emails, public posts, social media, client deliverables | Immediately — block external action until fixed | Fix is drafted but requires human approval before applying to external-facing content |
| **High**     | Claim in procedures, knowledge base, SOUL.md, standing orders, or reusable templates              | Within 24 hours                                 | Yes — auto-apply fix, notify via Telegram                                             |
| **Medium**   | Claim in daily logs, session transcripts, task completion notes                                   | Within 7 days                                   | Yes — auto-apply fix, log silently                                                    |
| **Low**      | Claim in internal planning, scratch notes, draft analysis                                         | Opportunistic                                   | Yes — tag only, defer correction to next relevant task                                |

**Severity detection by source path:**

- **Critical:** `workspace/outputs/*`, `workspace/deliverables/*`, content staged for Telegram/email send
- **High:** `workspace/procedures/*`, `workspace/memory/MEMORY.md`, `workspace/SOUL.md`, `workspace/references/*`, `workspace/standing-orders/*`
- **Medium:** `workspace/memory/2026-*.md`, `workspace/memory/sessions/*`, `workspace/memory/tasks.json` (completed entries)
- **Low:** Everything else — `workspace/scratch/*`, `workspace/planning/*`, draft files, internal notes

**Escalation:** If auto-fix fails the re-check, severity escalates one level (Low→Medium→High→Critical). Critical triggers urgent Telegram alert and a blocking task.

---

### 3. Auto-Task Generation Template

When a violation is detected, generate a correction task with this structure and append to `memory/tasks.json`:

```json
{
  "id": "epistemic-fix-{violation_type}-{YYYYMMDD}-{seq}",
  "title": "Epistemic fix: {violation_type} in {source_file}",
  "type": "epistemic-correction",
  "priority": "{severity}",
  "created": "{ISO-8601 timestamp}",
  "source_review": "{review timestamp from epistemic-reviews.jsonl}",
  "violation": {
    "type": "{violation_type}",
    "fallacy": "{fallacy name from fallacies.md}",
    "claim": "{the problematic claim text}",
    "source_file": "{path to file containing the claim}",
    "source_line": "{line number or section reference}",
    "reviewer": "{gemini|grok|chatgpt}",
    "review_evidence": "{reviewer's explanation of the violation}"
  },
  "correction_rule": "{rule ID from Section 1, e.g., 1.1, 1.2}",
  "steps": [
    "1. Read original claim in {source_file}",
    "2. Apply correction rule {correction_rule}",
    "3. Update source with corrected claim and confidence tag",
    "4. Run epistemic re-check on corrected claim",
    "5. Log fix result in epistemic-reviews.jsonl"
  ],
  "acceptance_criteria": [
    "Claim has appropriate confidence tag ({expected_tag})",
    "Scope qualifiers are present where required",
    "Evidence receipts attached or verification task queued",
    "Re-check passes without same violation"
  ],
  "deadline": "{calculated from severity}",
  "status": "pending"
}
```

Task naming convention: `epistemic-fix-{type}-{date}-{seq}`
Examples: `epistemic-fix-hasty-generalization-20260331-01`, `epistemic-fix-false-cause-20260401-01`

Fix results are logged to `memory/epistemic-fix-metrics.jsonl` (one JSON line per fix attempt).

---

### 4. Integration Points

**4.1 Heartbeat Idle Loop**
During idle heartbeat cycles (no active task running):

1. Check `memory/tasks.json` for `type: "epistemic-correction"` tasks with `status: "pending"`.
2. If found within the severity deadline window, execute the highest-severity pending fix.
3. If no pending fixes, check `memory/verification-queue.jsonl` for UNVERIFIED claims due for re-verification.
4. Attempt automated verification (re-fetch URLs, re-run tests, re-query data sources) and update confidence tags.
5. Guard: maximum 2 epistemic fixes per heartbeat cycle.

**4.2 Task Completion Gate**
Before any task is marked `status: "done"` or `status: "pending_review"`:

1. Run a mini epistemic check on the task's output/deliverable covering all 7 violation types.
2. Low/Medium severity: log violation and allow task completion, but create a follow-up epistemic-correction task.
3. High/Critical severity: block task completion until violation is fixed or explicitly waived by Francisco.

Sequence: Execute → Reflect (self-evaluate) → Epistemic mini-check → Peer Review → Done

**4.3 Sunday Cron Aggregation**
During the Sunday review cycle ("ALL THREE" + Summary Report):

1. Aggregate all violations from the past 7 days from `epistemic-reviews.jsonl`.
2. Aggregate all fix results from `epistemic-fix-metrics.jsonl`.
3. Produce a weekly epistemic health report: violations by type, fix success rate, time-to-fix distribution, trend vs. prior week, top 3 recurring patterns with recommended procedural changes.
4. Store report in `memory/epistemic-weekly-{YYYY-WNN}.md`.
5. Send summary to Francisco via Telegram.
