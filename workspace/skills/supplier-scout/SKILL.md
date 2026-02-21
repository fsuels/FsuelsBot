---
name: supplier-scout
description: "Research products and suppliers on 1688/Alibaba for DressLikeMommy. Use when: (1) Finding new products to list, (2) Comparing supplier prices, (3) Vetting a vendor, (4) Checking product availability, (5) Sourcing alternatives for existing products."
---

# Supplier Scout

Research and vet products/suppliers on 1688.com and Alibaba for the DressLikeMommy store.

## Business Context

- **Niche**: Mommy and me / family matching outfits
- **Source**: Primarily 1688.com (Chinese wholesale)
- **Fulfillment**: BuckyDrop (imports from 1688, ships to customers)
- **Margin rule**: Need ≥50% profit after all costs. See `procedures/pricing.md`

## Tools Used

- `browser` — Navigate 1688.com, read product pages, extract data
- `web_search` — Find products, compare prices, discover trends
- `web_fetch` — Pull product details from URLs
- `write` — Save findings to knowledge files

## Core Operations

### Product Discovery

1. Search 1688.com with Chinese keywords for target category
2. Sort by newest / recent sales (avoid stale listings)
3. Filter: matching adult + child sizes, good photos, reasonable price
4. Collect top 5-8 candidates per search

### Vendor Vetting (from `procedures/product-listing.md` Gate 1)

For each vendor, verify:

- [ ] Store rating ≥ 4.0 (prefer 4.5+)
- [ ] Active recent sales (not dead store)
- [ ] Store age 1+ years
- [ ] High response rate
- [ ] Allows 1-piece dropshipping
- [ ] 24-48hr delivery to BuckyDrop warehouse

**Red flags (REJECT):**

- No recent sales/reviews
- New store with no history
- Poor ratings / many complaints
- Old listings (discontinued products used as hooks)

### Fallacy Check (MANDATORY)

Before recommending any vendor:

- [ ] Rating is actual (not bought reviews)
- [ ] "Factory direct" verified, not just claimed
- [ ] Sales volume cross-checked with review count
- [ ] Not selecting because "others use this vendor"
- [ ] At least 2 quality indicators agree

### Price Comparison

1. Extract product price + weight from 1688 listing
2. Estimate BuckyDrop costs (product + domestic + YunExpress intl)
3. Calculate minimum selling price (total x 1.5)
4. Compare vs competitors on Amazon/Etsy
5. Flag if margin < 50% or competitors all cheaper

### Alternative Sourcing

When an existing product's supplier becomes unreliable:

1. Search 1688 for same/similar product
2. Compare: price, quality indicators, delivery time
3. Present top 3 alternatives with cost comparison

## Output Format

For each researched product, report:

```
**[Product Name]**
- 1688 URL: [link]
- Vendor: [name] | Rating: [X] | Sales: [Y]
- Price: ¥[X] (~$[Y])
- Weight: [X]g
- Sizes: [adult + child ranges]
- Est. total cost: $[X] → Min price: $[Y]
- Competitor range: $[A]-$[B]
- Verdict: [GO / MAYBE / SKIP] — [reason]
```

## Permission Tiers

| Action                           | Tier | Rule                       |
| -------------------------------- | ---- | -------------------------- |
| Research, browse, compare        | 0    | Just do it                 |
| Save findings to knowledge files | 0    | Just do it                 |
| Recommend products for listing   | 1    | Do it, report to Francisco |
| Import to BuckyDrop              | 1    | Do it, report after        |
| Commit to a new supplier         | 2    | Confirm with Francisco     |
