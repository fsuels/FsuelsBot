---
name: council
description: "Multi-AI debate using Grok, ChatGPT, Gemini, Claude. Use when: Francisco says 'council', 'debate', or a question needs stress-testing from multiple viewpoints."
---

# The Council -- Multi-AI Discovery Engine

Uses multiple LLMs with different training biases to find insights no single model would surface. Cost: $0 (all existing subscriptions).

## Trigger Conditions

When to invoke this skill:

- Francisco says "council", "debate", "stress-test", or "get multiple opinions"
- A high-stakes business decision needs adversarial validation before committing
- A research question has no clear consensus and benefits from competing viewpoints

## Required Inputs

| Input       | Source                  | Required | Example                                       |
| ----------- | ----------------------- | -------- | --------------------------------------------- |
| question    | User message            | Yes      | "Should we expand into matching pet outfits?" |
| panel_size  | User or default (4)     | No       | 3 (minimum viable council)                    |
| round_count | User or default (2-3)   | No       | 2 (diverge + cross-examine)                   |
| focus       | User or default (broad) | No       | "financial viability only"                    |

## The Panel

| AI                | Access                       | Role                                          |
| ----------------- | ---------------------------- | --------------------------------------------- |
| **Grok**          | Browser (X tab)              | Adversary -- find why this fails              |
| **ChatGPT**       | Browser (chatgpt.com)        | Formalist -- logic, structure                 |
| **Gemini**        | CLI (`gemini -p`) or browser | Empiricist -- reality checks                  |
| **Claude Sonnet** | Native spawn                 | Orchestrator -- run the session               |
| **Claude Opus**   | Main session                 | Synthesist -- final verdict with full context |

## Data Collection Steps

1. **Diverge (Round A)** -- tool: `browser` (Grok, ChatGPT), `gemini` CLI, native spawn (Sonnet)
   - Send the same question to each AI with assigned roles
   - Each AI answers independently; penalize early convergence
   - Expected: 3-4 distinct responses with different perspectives
   - If an AI is unreachable: proceed with remaining panel (3/4 = valid council)

2. **Cross-examine (Round B)** -- tool: same as Round A
   - Share all Round A responses with each AI
   - Prompt each: "Where are they WRONG? What did they MISS?"
   - Expected: specific rebuttals and overlooked factors surface
   - If an AI times out: use its Round A response as final

3. **Red-team (Round C, optional)** -- tool: same as Round A
   - Only if productive disagreement remains after Round B
   - Final rebuttals focused on remaining disputes
   - If skipped: note "Round C skipped -- consensus reached in Round B"

4. **Bottleneck** -- tool: `browser` (Grok)
   - Send ALL outputs to Grok with prompt: "Find the one assumption they ALL share that is most likely wrong"
   - Expected: one meta-insight that challenges shared blind spots
   - If Grok unavailable: Claude Opus performs this step

5. **Synthesize** -- tool: native (Claude Opus, main session)
   - Review all rounds; produce final synthesis (NOT a vote)
   - Output is one of: smallest claim surviving all attacks, structured hypotheses with probabilities, or "Underdetermined"

## ChatGPT Input Fix

```javascript
var el =
  document.querySelector("#prompt-textarea") || document.querySelector("[contenteditable=true]");
el.focus();
el.innerText = "QUESTION";
el.dispatchEvent(new Event("input", { bubbles: true }));
```

## Output Format

### Deliverable: Council Session Report

Delivery method: Telegram summary + file
File path: `council-sessions/YYYY-MM-DD-topic.md`

```
**Council Session -- [Date] -- [Topic]**

**Question:** [The original question]

**Round A (Diverge):**
- Grok (Adversary): [key points]
- ChatGPT (Formalist): [key points]
- Gemini (Empiricist): [key points]
- Sonnet (Orchestrator): [key points]

**Round B (Cross-examine):**
- Key disagreements: [list]
- Overlooked factors: [list]

**Bottleneck insight:** [The shared assumption most likely wrong]

**Synthesis:**
[One of: smallest surviving claim / structured hypotheses / underdetermined]

**Confidence:** [high/medium/low]
**Minority opinions preserved:** [any dissenting views worth tracking]
```

## Success Criteria

- [ ] At least 3 of 4 AIs responded in Round A
- [ ] Cross-examination (Round B) produced at least one substantive disagreement
- [ ] Bottleneck step identified a shared assumption
- [ ] Final synthesis is clearly one of the three valid output types (not a vote)
- [ ] Session file saved to `council-sessions/`
- [ ] Telegram summary sent to Francisco
- [ ] Minority opinions logged to `council-sessions/minority-opinions.jsonl`

## Error Handling

| Failure               | Detection                           | Response                                                         |
| --------------------- | ----------------------------------- | ---------------------------------------------------------------- |
| Grok unreachable      | Browser tab fails to load / timeout | Proceed with 3/4 panel; note in report                           |
| ChatGPT unreachable   | Browser navigation fails            | Proceed with 3/4 panel; note in report                           |
| Gemini CLI fails      | `gemini -p` returns non-zero        | Fall back to browser (gemini.google.com); if that fails, 3/4     |
| ChatGPT input blocked | JS injection fails                  | Try alternative selector; if still blocked, use Gemini as backup |
| < 3 AIs available     | Count of successful Round A < 3     | Abort council; notify Francisco "insufficient panel"             |
| Session too long      | Total token count exceeds threshold | Summarize intermediate rounds; proceed to synthesis              |

## Evidence Standards

- Label each AI's contribution with its name and assigned role
- Note which round each insight emerged from (A, B, or C)
- Flag when an AI changed its position between rounds
- Distinguish between factual claims (verifiable) and opinions/predictions
- Record any AI that was unavailable and note impact on session quality
- Minority opinions logged separately in `council-sessions/minority-opinions.jsonl`
- Failed sessions logged to `council-sessions/failures.jsonl` with reason

## Permission Tiers

| Action                           | Tier | Rule                   |
| -------------------------------- | ---- | ---------------------- |
| Run council session, research    | 0    | Just do it             |
| Save session files, send summary | 1    | Do it, report after    |
| Act on council recommendation    | 2    | Confirm with Francisco |
