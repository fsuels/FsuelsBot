# Revenue Jobs (Cash-First + Money-Brain)

## Quick start

```bash
pnpm revenue:baseline
pnpm revenue:demand
pnpm revenue:outreach
pnpm revenue:report
```

Data root defaults to `~/.openclaw/revenue`.
Override with:

```bash
export OPENCLAW_REVENUE_DIR=/path/to/revenue-data
```

## Inputs

- Opportunity inbox: `inbox/opportunity-candidates.jsonl`
- Orders queue: `orders.json`

Example opportunity candidate row:

```json
{
  "title": "AI conversion audit",
  "projectId": "svc-main",
  "source": "forum",
  "demand": 82,
  "pricingPower": 74,
  "competition": 48,
  "regRisk": 12,
  "speedToValidation": 78,
  "marginPotential": 75,
  "deliveryEffort": 34,
  "channelFriction": 22,
  "refundSupportRisk": 16,
  "expectedDaysToFirstRevenue": 10,
  "paybackDaysEstimate": 18,
  "demandConfirmations": 3
}
```

## Job cadence

Phase 1 (Days 1-14):

- `pnpm revenue:demand`
- `pnpm revenue:outreach`
- `pnpm revenue:delivery`
- `pnpm revenue:report`

Phase 2+:

- `pnpm revenue:experiments:seed`
- `pnpm revenue:experiments:evaluate`
- `pnpm revenue:weekly`

## Suggested cron skeleton

```cron
# Daily demand scan and outreach
15 8 * * * cd /path/to/openclaw && pnpm revenue:demand && pnpm revenue:outreach

# Weekday delivery batch
30 11 * * 1-5 cd /path/to/openclaw && pnpm revenue:delivery

# Daily revenue report
45 18 * * * cd /path/to/openclaw && pnpm revenue:report

# Seed + evaluate experiments nightly
10 22 * * * cd /path/to/openclaw && pnpm revenue:experiments:seed && pnpm revenue:experiments:evaluate

# Weekly capital allocation (Monday)
0 9 * * 1 cd /path/to/openclaw && pnpm revenue:weekly
```
