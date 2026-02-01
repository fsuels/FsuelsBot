---
updated: 2026-01-29
version: "1.0"
created: "2026-01-28"
updated: "2026-01-28"
verified: "2026-01-28"
confidence: "medium"
---

# Reusable Artifact Pipeline
*Source: Council Team Architecture Debate (EVT-20260128-065)*
*Established: 2026-01-28*

## Philosophy

**Compression > Generation.** If you wrote it well once, template it. Every significant output should become a reusable artifact that makes future work faster.

## What Counts as an Artifact

| Type | Example | Stored In |
|------|---------|-----------|
| **Template** | Product description template, tweet formula, email template | `knowledge/templates/` |
| **Checklist** | Product launch checklist, SEO audit checklist, security audit | `knowledge/procedures/` |
| **SOP** | How to add a product, how to run Council, how to handle BuckyDrop | `knowledge/procedures/` |
| **Script** | Cleanup script, redirect generator, sitemap parser | `mission-control/` or workspace |
| **Prompt** | Optimized system prompt, function prompt template | `knowledge/templates/` |
| **Research brief** | Competitor analysis template, opportunity brief format | `knowledge/insights/` |
| **Decision record** | Council verdict, architecture decision | `council-sessions/` |

## When to Create an Artifact

### Automatic (Pressure Loop checks)
- Same type of task done 3+ times â†’ template it
- Same question asked 2+ times â†’ SOP it
- Same error hit 2+ times â†’ checklist to prevent it
- Sub-agent output was excellent â†’ save as reference example

### Manual (Orchestrator decides)
- Francisco asks for something that will recur
- New procedure established
- Important decision made (save reasoning)

## Artifact Quality Rules

1. **Self-contained.** Anyone (or any AI) should understand it without context.
2. **Actionable.** Steps, not concepts. Checklists, not essays.
3. **Dated.** Include creation date and last verified date.
4. **Sourced.** Reference the event or decision that created it.
5. **Versioned.** If updated, note what changed and why.

## Artifact Lifecycle

```
Task output produced
    â†’ Pressure Loop reviews: "Is this reusable?"
    â†’ If YES: extract artifact, save to knowledge/
    â†’ Log creation in ledger (type: "artifact")
    â†’ Future similar tasks: check knowledge/ first
    â†’ If template exists: use it, don't start from scratch
    â†’ Pressure Loop: "Is this template still accurate?"
    â†’ If NO: update or retire
```

## Directory Structure

```
knowledge/
â”œâ”€â”€ templates/          # Reusable output templates
â”‚   â”œâ”€â”€ product-description.md
â”‚   â”œâ”€â”€ tweet-formulas.md
â”‚   â”œâ”€â”€ email-templates.md
â”‚   â””â”€â”€ research-brief.md
â”œâ”€â”€ procedures/         # How-to guides (SOPs, checklists)
â”‚   â”œâ”€â”€ dispatch-scoring.md
â”‚   â”œâ”€â”€ event-triggers.md
â”‚   â”œâ”€â”€ autonomy-tiers.md
â”‚   â””â”€â”€ ...
â”œâ”€â”€ principles/         # Standing rules and constraints
â”œâ”€â”€ insights/           # Learned patterns and wisdom
â””â”€â”€ entities/           # People, companies, accounts
```

## Metrics

Track in monthly review:
- **Artifacts created** this month
- **Artifacts reused** (how many times a template was used)
- **Time saved** (estimated reduction in task completion time)
- **Stale artifacts** (not used in 60+ days â€” review or retire)

