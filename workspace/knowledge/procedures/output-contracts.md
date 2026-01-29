---
version: "1.0"
created: "2026-01-28"
updated: "2026-01-28"
verified: "2026-01-28"
confidence: "medium"
---

# Output Contracts
*Source: Council Team Architecture Debate (EVT-20260128-065)*
*Established: 2026-01-28*

## Philosophy

Every function returns **structured artifacts**, not essays. JSON, checklists, diffs, templates. Expansion only on request. Default 200-400 tokens. Burst to 800 only for reusable artifacts.

## Per-Function Contracts

### Content()
**Input:** Task type (tweet, product description, blog post, social copy) + context
**Output format:** Structured JSON
```json
{
  "type": "product_description",
  "title": "...",
  "body_html": "...",
  "meta_description": "...",
  "tags": ["...", "..."],
  "token_count": 350
}
```
**Max tokens:** 400 (descriptions), 800 (blog posts)
**Reusable artifact:** Save as template if pattern repeats 3+ times

### Automation()
**Input:** Problem description + desired outcome
**Output format:** Code diff or script
```json
{
  "type": "script",
  "filename": "...",
  "language": "python|javascript",
  "code": "...",
  "description": "What it does in 1 sentence",
  "test_command": "how to verify it works"
}
```
**Max tokens:** 400 (small scripts), 800 (complex automation)
**Reusable artifact:** All scripts saved to workspace with docstrings

### Council()
**Input:** Decision question + context + constraints
**Output format:** Structured verdict
```json
{
  "question": "...",
  "verdict": "...",
  "reasoning": "3 key points",
  "dissent": "strongest counterargument",
  "confidence": "high|medium|low",
  "implementation_steps": ["step1", "step2", "..."]
}
```
**Max tokens:** 800 (full debate produces more, but verdict summary ≤800)
**Reusable artifact:** Saved to council-sessions/ for future reference

### PromptWork()
**Input:** Agent/prompt to optimize + goal
**Output format:** Before/after diff
```json
{
  "target": "which prompt/agent",
  "changes": [
    {"section": "...", "before": "...", "after": "...", "why": "..."}
  ],
  "expected_improvement": "...",
  "test_method": "how to verify improvement"
}
```
**Max tokens:** 400
**Reusable artifact:** Updated prompts committed to workspace

### QA Loop (Pressure Loop)
**Input:** Completed task output
**Output format:** Improvement checklist
```json
{
  "task_reviewed": "...",
  "grade": "A|B|C|D|F",
  "improvements": [
    {"type": "faster|automate|template|eliminate", "description": "...", "score": 0}
  ],
  "artifacts_created": ["template.md", "checklist.md"],
  "next_action": "none|spawn_function|escalate"
}
```
**Max tokens:** 300
**Reusable artifact:** Improvement patterns → knowledge/insights/

### Research Loop (Deep Dive)
**Input:** Research area or trigger event
**Output format:** Opportunity brief
```json
{
  "area": "...",
  "findings": [
    {"finding": "...", "source": "URL or reference", "impact": 1-5, "confidence": 1-5}
  ],
  "top_3_actions": ["...", "...", "..."],
  "score": 0
}
```
**Max tokens:** 400 (briefs), 800 (deep dives)
**Reusable artifact:** Key findings → knowledge/insights/

## Rules

1. **No essays.** If output isn't structured, it's wrong.
2. **Token counts enforced.** Agent must self-report token count.
3. **Expansion on request only.** Start compressed, expand if Francisco asks.
4. **Every good output → artifact.** If written well once, template it.
5. **Artifacts go to workspace.** Templates in knowledge/, scripts in mission-control/ or workspace root.
