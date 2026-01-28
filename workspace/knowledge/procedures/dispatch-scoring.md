# Dispatch Scoring System
*Source: Council Team Architecture Debate (EVT-20260128-065)*
*Established: 2026-01-28*

## Formula

```
Score = 2×Impact + Confidence + TimeSense − Cost
```

### Factors (each scored 1-5)

| Factor | 1 (Low) | 3 (Medium) | 5 (High) |
|--------|---------|------------|----------|
| **Impact** | Nice-to-have improvement | Measurable business benefit | Direct revenue or critical fix |
| **Confidence** | Uncertain outcome, experimental | Reasonable chance of success | Proven approach, clear path |
| **TimeSense** | No deadline, anytime | Would be good this week | Urgent — deadline or opportunity window |
| **Cost** | Heavy (Opus + multiple rounds) | Medium (Sonnet sub-agent) | Light (quick inline task) |

### Score Ranges

| Score | Action |
|-------|--------|
| **12-15** | Execute immediately — high impact, time-sensitive |
| **8-11** | Queue as priority — do today |
| **5-7** | Backlog — do when nothing scores higher |
| **1-4** | Skip or defer — not worth the cycles right now |

### Examples

| Task | Impact | Confidence | TimeSense | Cost | Score | Action |
|------|--------|------------|-----------|------|-------|--------|
| Valentine's Day collection | 5 | 4 | 5 | 2 | **17** | Execute NOW |
| Fix ScamAdviser trust score | 4 | 3 | 3 | 2 | **12** | Execute today |
| Dashboard UX polish | 2 | 5 | 2 | 1 | **10** | Queue |
| Grandma & Me niche research | 3 | 3 | 2 | 2 | **9** | Queue |
| Rebuild memory system v4 | 3 | 4 | 1 | 4 | **7** | Backlog |

### Usage Rules

1. Score every task before dispatching
2. Always work highest-score items first
3. If two tasks tie, pick the one with higher Impact
4. Re-score backlog items weekly (TimeSense changes)
5. Francisco can override any score — his judgment > formula
