# 🧠 The Council — Multi-AI Discovery Engine

## Philosophy
The Council is a **distributed epistemic engine** — not a survey, not a vote, not a debate club. It uses heterogeneous LLMs as **epistemic instruments** to explore error surfaces, expose contradictions, and discover insights no single model would find.

**Core Principle:** Discovery doesn't require "true understanding." It requires **structured error surface exploration**. Multiple LLMs with orthogonal training distributions produce **non-overlapping failure modes**. When forced into adversarial role constraints, they expose blind spots a single model never surfaces.

**The Goal:** Better understanding → superior solutions. Every session should produce an insight that didn't exist before the debate started.

## The A+ Standard (MANDATORY)

**Never settle for incremental.** Push every debate to:
- **EXPLORE** — Think outside the box, challenge paradigms
- **DEBATE** — Real cross-examination, AIs argue with each other
- **DISCOVER** — Find NEW solutions that didn't exist before
- **AIM FOR A+** — Breakthroughs, not polish

## Cost Model — ZERO EXTRA
All AIs accessed through existing subscriptions. Extra cost: $0.00
- Claude Max ($100/month flat)
- X subscription (includes Grok)
- ChatGPT Pro (flat subscription)
- Gemini CLI (free)

## The Panel

| AI | Access | Epistemic Role | Job |
|---|---|---|---|
| **Grok** | Browser (X tab) | **Adversary/Falsification** | Find why this fails. Attack assumptions. |
| **ChatGPT** | Browser (chatgpt.com) | **Formalist/Structure** | Logic, invariants, system design |
| **Gemini** | CLI (`gemini -p`) or browser | **Empiricist/Pragmatic** | Technical blockers, data, reality checks |
| **Claude Sonnet** | Native spawn | **Orchestrator** | Run the session, manage rounds |
| **Claude Opus** | Main session | **Synthesist/Context** | Final verdict with full Francisco context |

## CRITICAL: Disagreement-First Protocol (DFP)

**Key Shift:** Reward incompatibility, not agreement.

### Round A — Initial Positions (Divergence Phase)
- Each AI answers independently
- Assign epistemic roles (Adversary, Formalist, Empiricist)
- **PENALIZE** if they converge too early

### Round B — Cross-Examination (Adversarial Phase)
- Share each AI's response with the others
- Ask: "Where are they WRONG? What did they MISS?"
- Demand: "What's the one assumption they share that's most likely wrong?"
- **This is where discovery happens**

### Round C — Red-Team Reflection (Optional)
- If productive disagreement remains
- Ask: "Final rebuttal. What's your strongest argument now?"
- Identify the "load-bearing wall" — try to kick it down

### The Bottleneck Phase (After Round B)
The Skeptic (Grok) gets all outputs and must find:
> "The one assumption they ALL agree on that is most likely to be wrong."

If it stands after attack, the insight is robust. If it breaks, you discovered a flaw.

## Failure Memory — Cumulative Epistemic System

**Science advances by remembering wrong paths. LLMs forget them every run.**

After each session:
1. Record what claims FAILED (were broken by cross-examination)
2. Persist these to `council-sessions/failures.jsonl`
3. Future councils are CONDITIONED on known dead ends
4. Never repeat the same failed path twice

**Failure Record Schema:**
```json
{
  "ts": "2026-01-30T00:45:00Z",
  "session": "council-skill-self-eval",
  "failed_claim": "Council produces 'averaged mediocrity'",
  "broken_by": "ChatGPT",
  "reason": "Only true with naive synthesis. Adversarial synthesis exploits disagreement, doesn't smooth it.",
  "lesson": "Attack the synthesis method, not the council concept"
}
```

## Minority Opinion Tracking (ROUND 2 — Bandwagon Fallacy Prevention)

**Problem:** When one AI disagrees with the majority, we often dismiss them. But minority opinions are sometimes RIGHT — we just didn't know it yet.

**Solution:** Log minority dissents for retrospective review.

**Minority Record Schema:**
```json
{
  "ts": "2026-01-31T22:00:00Z",
  "session": "council-xyz",
  "minority_ai": "Grok",
  "minority_position": "This approach will fail because X",
  "majority_position": "This approach will work",
  "verdict_followed": "majority",
  "retrospective": null,
  "was_minority_right": null
}
```

**Retrospective Protocol:**
1. After 7 days, review minority opinions from that week
2. Check: Did the majority approach work? Did the minority concern materialize?
3. Update `was_minority_right` field
4. If minority was right: Log as learning, increase that AI's weight for similar topics

**File:** `council-sessions/minority-opinions.jsonl`

## Synthesis Rules — No Voting, No Averaging

**Final output is NOT "what most models say."**

It is ONE of:
1. **The smallest claim that survives ALL attacks** — Battle-tested truth
2. **A structured set of mutually exclusive hypotheses** — With probabilities
3. **"Underdetermined"** — When we genuinely don't know yet

**"Underdetermined" is a valid output.** It's a prerequisite for real insight.

## Semantic Variance Scoring (Quality Check)

Use embedding similarity between outputs to detect failure modes:

| Similarity | Diagnosis | Action |
|---|---|---|
| >0.9 | **Echo chamber** — Models agreeing without conflict | FAIL. Force divergence. |
| 0.5-0.9 | **Goldilocks Zone** — Agreement + novelty | GOOD. Proceed to synthesis. |
| <0.5 | **Hallucination/Divergence** — No common ground | Investigate. May be exploring genuinely novel space. |

## External Reality Anchors

**Every synthesis needs a falsifiability test:**
1. What would prove this wrong?
2. What testable prediction does it make?
3. Can we verify with external data?

**Demand sources:** For any factual claim, require URL or data source. Cross-examination IS hallucination containment.

**Action Sandbox:** Before finalizing action plans, mentally (or actually) test: Can this be executed? What fails first?

## Automation Technical Notes

### ChatGPT Input (Fixed 2026-01-30)
ChatGPT uses contenteditable ProseMirror editor. Standard type() fails.

**Solution:**
```javascript
var el = document.querySelector('#prompt-textarea') || document.querySelector('[contenteditable=true]');
el.focus();
el.innerText = 'YOUR QUESTION HERE';
el.dispatchEvent(new Event('input', {bubbles: true}));
// Now "Send prompt" button appears
```

### Fallback Ladder
1. **Gemini CLI first** — Most reliable, no browser needed
2. **One tab at a time** — Close other AI tabs, focus on single target
3. **Proceed with partial** — 3/4 AIs is valid Council

**RULE: Never grind. Never ask human to fill gaps. Work with what you have.**

### Time Estimates (Realistic)
- Quick Council (CLI only): 5-10 min
- Full 3-round debate: 20-30 min
- Multi-round A+ session: 45-60 min

## Trigger
User says:
- "Council: [question]"
- "Ask the council: [question]"
- "Debate: [question]"
- Or you decide a question benefits from multiple viewpoints

## Context Injection (MANDATORY)

Before ANY Council session, include:
1. **Current system state** — What we already have
2. **What's working** — Don't break this
3. **Constraints** — Budget, tools, limitations
4. **The specific problem** — Not vague "make it better"

## Output Format

```
🧠 THE COUNCIL — [Topic]

📋 QUESTION: [The question asked]

🔥 ROUND A POSITIONS:
- GROK (Adversary): [summary]
- CHATGPT (Formalist): [summary]
- GEMINI (Empiricist): [summary]

⚔️ ROUND B CROSS-FIRE:
- Strongest disagreement: [what and why]
- Broken claims: [what got killed]
- Surviving insights: [what stood up]

🎯 SYNTHESIS:
[Not average. Smallest claim surviving all attacks, OR structured hypotheses, OR "underdetermined"]

🏆 VERDICT:
[Definitive recommendation with reasoning]

📝 FAILURE LOG:
[What we learned NOT to do]
```

## Session Storage
Save sessions to `council-sessions/YYYY-MM-DD-topic.md`

Save failures to `council-sessions/failures.jsonl`

## When to Auto-Trigger
- Major business strategy decisions
- When you want to stress-test your own recommendation
- Complex topics where first answer is probably incomplete
- When Round A shows significant disagreement

---

*This is not a chat. This is a distributed epistemic engine.*
