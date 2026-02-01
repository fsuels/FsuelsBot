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
|-----|----------------|----------------|
| Mon | Gemini | Grok |
| Tue | ChatGPT | Gemini |
| Wed | Grok | ChatGPT |
| Thu | Gemini | Grok |
| Fri | ChatGPT | Gemini |
| Sat | Grok | ChatGPT |
| Sun | ALL THREE | Summary Report |

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
