---
name: council
description: "Multi-AI debate using Grok, ChatGPT, Gemini, Claude. Use when: Francisco says 'council', 'debate', or a question needs stress-testing from multiple viewpoints."
---

# The Council — Multi-AI Discovery Engine

Uses multiple LLMs with different training biases to find insights no single model would surface.

## Cost: $0 (all existing subscriptions)

## The Panel

| AI                | Access                       | Role                                         |
| ----------------- | ---------------------------- | -------------------------------------------- |
| **Grok**          | Browser (X tab)              | Adversary — find why this fails              |
| **ChatGPT**       | Browser (chatgpt.com)        | Formalist — logic, structure                 |
| **Gemini**        | CLI (`gemini -p`) or browser | Empiricist — reality checks                  |
| **Claude Sonnet** | Native spawn                 | Orchestrator — run the session               |
| **Claude Opus**   | Main session                 | Synthesist — final verdict with full context |

## Round Structure

**Round A (Diverge):** Each AI answers independently. Assign roles. Penalize early convergence.

**Round B (Cross-examine):** Share responses. Ask each: "Where are they WRONG? What did they MISS?" This is where discovery happens.

**Round C (Optional red-team):** If productive disagreement remains, final rebuttals.

**Bottleneck:** Grok gets all outputs, finds "the one assumption they ALL share that is most likely wrong."

## Synthesis Rule

Final output is NOT a vote. It's ONE of:

1. Smallest claim surviving all attacks
2. Structured hypotheses with probabilities
3. "Underdetermined" — a valid output

## ChatGPT Input Fix

```javascript
var el =
  document.querySelector("#prompt-textarea") || document.querySelector("[contenteditable=true]");
el.focus();
el.innerText = "QUESTION";
el.dispatchEvent(new Event("input", { bubbles: true }));
```

## Fallback: Gemini CLI first (most reliable). 3/4 AIs = valid council. Never grind.

## Storage

- Sessions: `council-sessions/YYYY-MM-DD-topic.md`
- Failures: `council-sessions/failures.jsonl`
- Minority opinions: `council-sessions/minority-opinions.jsonl`
