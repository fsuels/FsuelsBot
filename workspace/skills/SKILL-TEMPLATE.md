---
name: skill-name
description: "One-line description. Use when: (1) condition, (2) condition."
version: 1.0.0
metadata: { "clawdbot": { "emoji": "X", "requires": { "bins": [] } } }
---

# Skill Name

One paragraph: what this skill does and why it exists.

## Trigger Conditions

When to invoke this skill:

- Explicit triggers (user says X, cron fires, event received)
- Implicit triggers (new product added, competitor price change detected)

## Required Inputs

| Input      | Source                        | Required | Example                    |
| ---------- | ----------------------------- | -------- | -------------------------- |
| topic      | User message                  | Yes      | "matching swimwear trends" |
| date_range | User or default (last 7 days) | No       | "2026-03-01 to 2026-03-31" |

## Data Collection Steps

1. **Step name** -- tool: `tool_name`
   - What to do
   - Expected result
   - If this fails: [fallback]

2. **Step name** -- tool: `tool_name`
   - What to do
   - Expected result
   - If this fails: [fallback]

## Output Format

### Deliverable: [Name]

Delivery method: Telegram / file / both
File path: `workspace/[path]`

```
[Exact template of output with placeholders]
```

## Success Criteria

- [ ] All required inputs were available or had valid defaults
- [ ] All data collection steps completed (or fallbacks used)
- [ ] Output file exists at expected path and is non-empty
- [ ] Delivery confirmed (Telegram send exit code 0, or file written)
- [ ] All data points have source attribution

## Error Handling

| Failure            | Detection                          | Response                                |
| ------------------ | ---------------------------------- | --------------------------------------- |
| Tool X unavailable | Command returns non-zero / timeout | [Specific fallback]                     |
| Data source empty  | Result is null/empty array         | [Skip with placeholder / retry / abort] |
| Delivery fails     | Send command exit code != 0        | [Retry once, then save locally and log] |

## Evidence Standards

- Every factual claim must include source (URL, file path, or API endpoint)
- Prices and numbers must include scrape/query timestamp
- Use confidence tags: [verified], [estimated], [unconfirmed]
- Flag data older than [N hours/days] as potentially stale
- Distinguish between extracted data and inferred/calculated values

## Permission Tiers

| Action                         | Tier | Rule                   |
| ------------------------------ | ---- | ---------------------- |
| Read/research/draft            | 0    | Just do it             |
| Save files, send alerts        | 1    | Do it, report after    |
| Publish, delete, change prices | 2    | Confirm with Francisco |
