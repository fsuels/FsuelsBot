# Persistent Loop Definitions
*Source: Council Team Architecture Debate (EVT-20260128-065)*
*Established: 2026-01-28*

## Loop 1: Pressure Loop (QA & Continuous Improvement)

### Identity
- **Name:** Pressure Loop
- **Emoji:** 📈
- **Model:** claude-sonnet-4
- **Skill:** self-improvement
- **Autonomy:** Tier 2 (Propose + Spawn)

### When It Runs
After EVERY significant task completion, the Pressure Loop asks:

```
PRESSURE CHECK:
1. Can this output be FASTER next time? (template it?)
2. Can this be AUTOMATED? (script it?)
3. Can this be TEMPLATED? (reusable artifact?)
4. Should this be ELIMINATED? (unnecessary work?)
5. Did this task FAIL or DEGRADE? (log learning)
```

### Triggers
| Event | Action |
|-------|--------|
| Sub-agent task completes | Run pressure check on output |
| Error detected | Log to .learnings/, check for pattern |
| 3+ similar tasks in a week | Propose template/automation |
| Heartbeat (2x daily) | Review recent outputs for improvement opportunities |
| Monthly review | Generate earn/kill metrics report |

### Outputs
- Improvement proposals (scored, added to backlog)
- Templates saved to `knowledge/`
- Learnings logged to `.learnings/`
- Spawn requests for Automation() or Content()

### Success Metrics
- Number of templates created per month
- Number of automations proposed → implemented
- Reduction in orchestrator repeat tasks
- Error pattern detection rate

---

## Loop 2: Research & Opportunity Mining (Deep Dive)

### Identity
- **Name:** Deep Dive
- **Emoji:** 🔬
- **Model:** gemini-2.5-pro
- **Skill:** research
- **Autonomy:** Tier 2 (Propose + Spawn)

### When It Runs
Daily cadence + event triggers. Always looking for the next opportunity.

### Triggers
| Event | Action |
|-------|--------|
| Daily 9 AM cron | Morning research brief (AI news, competitor scan, market trends) |
| New product added to Shopify | Research competitor pricing for that category |
| Francisco sends a link | Deep analysis of the linked content |
| Seasonal event approaching (<30 days) | Research seasonal opportunities |
| Competitor change detected | Alert + response proposal |
| Heartbeat (1x daily) | Light opportunity scan if no research today |

### Outputs
- Opportunity briefs (scored, with top 3 actions)
- Competitor alerts
- Trend reports
- Product ideas with sourcing suggestions
- All saved to `knowledge/insights/` or `mission-control/`

### Success Metrics
- Opportunities surfaced per month
- Opportunities → implemented per month
- Revenue impact of implemented opportunities
- Francisco engagement with research briefs

---

## How Loops Interact

```
Research Loop finds opportunity
    → Scores it (Impact × Confidence)
    → If score ≥ 8: proposes to Orchestrator
    → Orchestrator decides: execute, delegate, or backlog
    → If delegate: spawns appropriate function
    → On completion: Pressure Loop reviews output
    → Pressure Loop: can this be templated/automated?
    → Cycle continues
```

## Integration with Heartbeat

Update `HEARTBEAT.md` to include loop checks:
- **Every heartbeat:** Check if Pressure Loop has pending reviews
- **Every heartbeat:** Check if Research Loop has pending briefs
- **Both loops** can queue work that the Orchestrator picks up on next heartbeat
