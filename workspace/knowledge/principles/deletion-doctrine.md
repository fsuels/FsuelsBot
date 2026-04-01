---
version: "1.1"
created: "2026-01-28"
updated: "2026-03-31"
verified: "2026-01-28"
confidence: "high"
---

# Principle: The Deletion Doctrine

_Priority: P0_
_Source: Council Three Visionaries Debate, 2026-01-28_
_Inspired by: Elon Musk's 5-Step Algorithm_

## Rule

Before building, optimizing, or automating anything, run the 5-step filter:

1. **Question:** Should this exist? Who asked for it? What revenue or customer impact does it have?
2. **Delete:** If it can't justify its existence, delete it. Default to deletion. Track a 10% add-back rate — if you're not re-adding at least 10% of what you delete, you aren't deleting aggressively enough.
3. **Simplify:** Only after deletion. Reduce the remaining to its simplest possible form.
4. **Accelerate:** Compress cycle time. Faster iterations beat better plans.
5. **Automate:** Last step, not first. Never automate something that shouldn't exist.

## When to Apply

This filter runs BEFORE any of these actions:

- Creating a new knowledge file, procedure, or principle
- Adding a new cron task or scheduled agent
- Building a new feature or automation script
- Adding a new persona, workflow, or output contract
- Expanding the bootstrap/system prompt

If a proposed addition cannot answer "who asked for this AND what measurable impact does it have?" — it does not get created.

## Enforcement

- The QA Pressure Loop asks "should this exist?" as its FIRST check on every output
- Every new procedure/file must justify its existence or be rejected
- Quarterly "deletion audit" — review all procedures, files, and agents for cut candidates
- The `goal-hierarchy.md` is the arbiter: if a task does not map to the goal tree, it is a deletion candidate

## Practical Examples

| Situation                                 | Doctrine says                                                                                  |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------- |
| "Let's add a persona for email marketing" | Question first: do we send marketing emails? No -> DELETE the idea                             |
| "We should track 15 metrics daily"        | Simplify: which 3 metrics actually drive decisions? Delete the rest                            |
| "Let's automate social posting"           | Is the manual version working and validated? No -> fix the manual version first, automate last |
| "This knowledge file has 10 lines"        | Does it contain unique, actionable info? Yes -> keep. No -> merge or delete                    |

## Anti-Patterns

- **Premature automation:** Building cron jobs for tasks that haven't been manually validated
- **Knowledge hoarding:** Keeping files "just in case" when they haven't been referenced in 90+ days
- **Ceremony creep:** Adding process steps, reviews, or reports nobody reads
- **Tool proliferation:** Installing new MCP servers or tools before exhausting existing ones

## Cross-References

- `goal-hierarchy.md` — the tree that determines what "should exist"
- `principles/tool-selection.md` — applies deletion thinking to tool choices
- `procedures/memory-consolidation.md` — confidence decay is deletion-adjacent (auto-expiry)
