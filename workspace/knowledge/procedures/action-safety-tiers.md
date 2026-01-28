# Action Safety Tiers
*Source: Council Team Architecture Debate (EVT-20260128-065)*
*Established: 2026-01-28*

## Three Safety Tiers

### Tier A — Auto (no approval needed)
Safe, reversible, internal actions. Do freely.

| Action | Example |
|--------|---------|
| Draft content | Product descriptions, blog posts, social copy |
| Generate templates | SOPs, checklists, prompt templates |
| Local code changes | Scripts, dashboard updates, config files |
| Research & analysis | Competitor research, market trends, audits |
| Memory operations | Write to memory files, update ledger, knowledge base |
| Git commits | Commit and push workspace changes |
| Read/analyze data | Shopify data, analytics, search console |
| Internal file management | Organize, clean up, restructure workspace |

### Tier B — Approve (needs orchestrator or Francisco approval)
Bounded external actions. Reversible but visible.

| Action | Approval By | Example |
|--------|-------------|---------|
| Publish to staging | Orchestrator | Preview blog post, test product listing |
| Schedule campaigns | Francisco | Email campaigns, social posts |
| Create/modify Shopify listings | Orchestrator | New product, price change, description update |
| Install apps/skills | Francisco | New Shopify app, new ClawdHub skill |
| Send messages on behalf | Francisco | Customer emails, supplier contact |
| Modify cron jobs | Orchestrator | Change schedules, add new periodic tasks |

### Tier C — Explicit Approve + Checklist (needs Francisco)
Irreversible, high-impact, or money-involved actions. Always ask.

| Action | Required | Example |
|--------|----------|---------|
| Spend money | Francisco explicit approval | Ad spend, app subscriptions, supplier payments |
| Change live pricing | Francisco explicit approval | Product prices, discount codes |
| Push to production | Francisco + diff review | Code deployments, theme changes |
| Contact customers | Francisco explicit approval | Order updates, marketing emails |
| Delete data | Francisco explicit approval | Remove products, delete files |
| Modify SOUL.md | Francisco notification | Changes to core identity/values |
| Public social posts | Francisco explicit approval | Tweets, social media content |
| Add paid services | Francisco explicit approval | Any new recurring cost |

## Decision Flow

```
Is this action reversible and internal?
├── YES → Tier A (auto)
└── NO → Does it involve money, customers, or public visibility?
    ├── YES → Tier C (Francisco approves)
    └── NO → Tier B (orchestrator approves, or Francisco if external)
```

## When In Doubt

**Ask.** Always safer to ask Francisco than to act on a Tier B/C action without approval. The cost of asking is seconds. The cost of a mistake could be hours or dollars.
