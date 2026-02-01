---
updated: 2026-01-29
version: "1.0"
created: "2026-01-28"
updated: "2026-01-28"
verified: "2026-01-28"
confidence: "medium"
---

# Task Prioritization
*Source: 4-Thinker Council (2026-01-28)*
*Replaces: dispatch-scoring.md*

## Task Priority Score (TPS)

```
TPS = (Revenue Impact Ã— Confidence) Ã· (Human Minutes Ã— Reversibility Risk)
```

| Factor | Scale | Description |
|--------|-------|-------------|
| Revenue Impact | 1-10 | Projected revenue or efficiency gain |
| Confidence | 0.2-1.0 | How data-backed is the estimate? |
| Human Minutes | 1-60 | Time for Francisco to verify output |
| Reversibility Risk | 1-5 | 1=trivially reversible, 5=permanent |

## Rules
- Agent ALWAYS picks highest TPS
- TPS < 0.5 â†’ do not execute autonomously
- Nightly ship phase only executes TPS â‰¥ 1.5
- If task doesn't map to goal hierarchy â†’ DELETE IT
- Auto-delete tasks stagnant > 3 days from bottom 20%

## Priority Override
1. **Unblock distribution** (GMC, ad channels) â€” always first
2. **Time-bound revenue** (Valentine's, seasonal) â€” second
3. **Everything else** â€” scored by TPS

