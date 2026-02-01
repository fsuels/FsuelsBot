---
type: insight
category: INS
confidence: 0.95
derived_from: ["2026-01-29 browser session", "Francisco feedback"]
validated: true
tags: [verified, pinned]
created: 2026-02-01
reviewed: 2026-02-01
---

# Bot vs Human Speed Reality

## The Insight

**Bot is SLOWER than human for visual/browser tasks.**

This is counterintuitive but verified through direct observation.

## The Math

### Bot (Browser Automation)
```
screenshot → process → decide → action → wait → repeat
= 5-15 seconds per step
```

### Human (Direct Interaction)
```
look → click
= 1 second
```

**Human is 5-15x faster for visual navigation.**

## Implications

### Bot Should Focus On:
- Research and data gathering
- Writing and content creation
- Analysis and pattern recognition
- Background work while human sleeps
- Tasks requiring memory/consistency
- Parallel operations (spawn sub-agents)

### Human Should Handle:
- Quick visual edits
- Simple click-through tasks
- Anything requiring < 5 actions
- Tasks where "I can see the button"

## Optimal Pattern

1. **Bot prepares** — research, draft content, calculate
2. **Bot creates instructions** — clear, copy-paste ready
3. **Human executes** — quick actions
4. **Bot verifies** — check result, document

## Anti-Pattern

❌ Bot clicking through 20 browser screens to do what human could do in 30 seconds.

## Application

When Francisco asks for something browser-based:
1. Assess: Is this <5 clicks and visual?
2. If YES → Prepare content/instructions, let human execute
3. If NO → Automate (multi-step, data-heavy, research)

---

*Learned: 2026-01-29. Validated by direct comparison.*
