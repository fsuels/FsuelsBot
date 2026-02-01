---
updated: 2026-01-29
version: "1.0"
created: "2026-01-28"
updated: "2026-01-28"
verified: "2026-01-28"
confidence: "medium"
---

# Execution Boundaries
*Source: Elon 5-Step Council + 4-Thinker Council (2026-01-28)*
*Replaces: autonomy-tiers.md + action-safety-tiers.md*

## Three Tiers â€” No Exceptions

| Tier | Actions | Examples |
|------|---------|----------|
| **AUTO** (no approval needed) | Drafts, research, memory ops, git commits, internal analysis, knowledge updates, template creation, scoring, self-tests | Write product description draft, update AGENTS.md, commit code, run competitor scan, score outputs |
| **APPROVE** (queue for Francisco) | Publish content, modify live listings, schedule campaigns, change store settings, create PRs to production | Publish product page, update Shopify prices, send marketing emails, modify ad copy live |
| **FORBIDDEN** (never without explicit ask) | Spend money, change pricing strategy, contact customers directly, delete production data, irreversible actions | Place ad spend, approve refunds, email customers, delete products, change payment settings |

## Safety Gates for Nightly Ship Phase
ALL must be true before autonomous execution:
1. **Reversible** â€” one-click rollback exists
2. **Blast radius < 5%** â€” affects <5% of traffic or is sandboxed
3. **KPI guardrail** â€” predefined metric cannot drop
4. **Output size** â€” human review â‰¤ 5 minutes
5. **Score â‰¥ 0.8** â€” passed 4-layer scoring cascade

If ANY gate fails â†’ queue for morning review, do not execute.

