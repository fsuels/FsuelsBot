# Earn/Kill Criteria
*Source: Council Team Architecture Debate (EVT-20260128-065)*
*Established: 2026-01-28*

## Philosophy

Persistence is earned, not assigned. Every agent must justify its existence through measurable output. No participation trophies.

## Earn Persistence (function → persistent agent)

An on-demand function earns persistent status if ALL of:
- ✅ **10+ tasks/month** without being explicitly prompted
- ✅ **Measurable work reduction** for orchestrator (fewer manual tasks)
- ✅ **Produces reusable artifacts** (templates, SOPs, checklists)
- ✅ **Runs loops, not just tasks** — generates its own work queue

**Review period:** Monthly, during biweekly Council review
**Promotion process:** QA Loop flags candidate → Council() debate → Francisco approves

## Demotion Triggers (persistent → on-demand function)

A persistent agent gets demoted if ANY of:
- ⚠️ **< 5 tasks in 2 weeks** without external factors (e.g., no research needed)
- ⚠️ **No measurable work reduction** — orchestrator still doing the same tasks
- ⚠️ **Not producing artifacts** — outputs are one-shot, never reused
- ⚠️ **Quality below threshold** — outputs consistently need rework

**Grace period:** 1 week warning before demotion
**Process:** QA Loop flags → Orchestrator reviews → demote or give specific improvement goal

## Kill Triggers (function removed entirely)

An on-demand function gets removed if ALL of:
- ❌ **Never invoked in 30 days**
- ❌ **Output quality consistently poor** when invoked
- ❌ **Duplicates another function's capability**

**Process:** QA Loop flags → Orchestrator confirms → remove from team.json
**Reversible:** Can always re-add if need arises. Functions are cheap to recreate.

## Tracking

### Monthly Metrics (checked during biweekly Council)

| Agent | Tasks | Artifacts | Work Reduced | Status |
|-------|-------|-----------|-------------|--------|
| Pressure Loop | count | count | yes/no | keep/warn/demote |
| Deep Dive | count | count | yes/no | keep/warn/demote |
| Content() | invocations | count | n/a | keep/kill |
| Automation() | invocations | count | n/a | keep/kill |
| Council() | invocations | count | n/a | keep/kill |
| PromptWork() | invocations | count | n/a | keep/kill |

### Where Tracked
- Task counts: `team.json` → `tasksCompleted` field (updated on every task)
- Artifacts: `knowledge/` directory + git commit count
- Monthly review: `council-sessions/monthly-review-YYYY-MM.md`

## Current Baseline (2026-01-28)

| Agent | Tasks to Date | Status |
|-------|--------------|--------|
| Orchestrator | 132 | Persistent (always) |
| Pressure Loop (ex-Intern) | 16 | Persistent — earning it |
| Deep Dive (ex-Research) | 10 | Persistent — earning it |
| Content() | 0 | On-demand — needs first invocation |
| Automation() | 17 | On-demand — strong history |
| Council() | 4 | On-demand — high-impact when used |
| PromptWork() | 0 | On-demand — needs first invocation |

## Exceptions

- **Seasonal agents:** Some functions spike during specific periods (Content() before holidays). Don't kill based on quiet months if seasonal pattern exists.
- **Francisco override:** Francisco can keep any agent regardless of metrics. His judgment > formula.
