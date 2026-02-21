---
name: competitor-monitor
description: "Monitor DressLikeMommy competitors for price changes, new products, and market trends. Use when: (1) Scheduled competitor check, (2) Francisco asks about competition, (3) Before pricing a new product, (4) Market research tasks."
---

# Competitor Monitor

Track competitor stores, prices, and trends to keep DressLikeMommy competitive.

## Known Competitors

Check and update `knowledge/business/competitor-*.md` files for current list. Key competitors include:

- **PatPat** — Large mommy-and-me retailer, aggressive pricing
- **SHEIN** — Fast fashion, very low prices (hard to compete on price alone)
- **Amazon sellers** — Various mommy-and-me shops
- **Etsy shops** — Handmade/boutique matching outfits
- **Other Shopify stores** — Google "[product] mommy and me matching"

## Tools Used

- `browser` — Visit competitor sites, check prices, screenshot layouts
- `web_search` — Find new competitors, trending products, market shifts
- `web_fetch` — Pull pricing data from competitor pages
- `write` — Save findings to knowledge files
- `message send` — Alert Francisco via Telegram on important changes

## Core Operations

### Full Competitor Audit

1. Visit each known competitor's site
2. Check: new arrivals, pricing changes, collection updates
3. Note: best sellers, promotional strategies, shipping offers
4. Compare against our current catalog and pricing
5. Save report to `knowledge/business/` with date

### Price Watch

1. For specific products, search competitors for same/similar items
2. Record: competitor name, price, shipping cost, any promo
3. Compare against our pricing
4. Flag if competitor is significantly cheaper than our minimum

### Trend Detection

1. Search for trending mommy-and-me products/styles
2. Check social media (Pinterest, Instagram, TikTok) for viral items
3. Identify gaps in our catalog vs market demand
4. Report opportunities to Francisco

### New Competitor Discovery

1. Periodically search Google Shopping, Etsy, Amazon for new sellers
2. Check if any new Shopify stores appeared in our niche
3. Assess their threat level (pricing, quality, marketing)
4. Add to competitor tracking files

## Alert Triggers

Send Telegram alert when:

- A competitor drops prices significantly (>20% on items we also sell)
- A new competitor appears with strong overlap in our niche
- A trending product emerges that we don't carry
- A competitor runs a major promotion or campaign

## Output Format

### Competitor Report

```
**Competitor Check — [Date]**

**[Competitor Name]**
- New products: [count] | Price range: $[X]-$[Y]
- Notable: [any significant change]
- vs Us: [how we compare]

**Opportunities**
- [Product/trend we should consider]
- [Price adjustment suggestions]

**Threats**
- [Competitor moves that could impact us]
```

### Price Alert

```
PRICE ALERT: [Competitor] now sells [product] at $[X]
Our price: $[Y] | Our cost: $[Z]
Action needed: [recommendation]
```

## Permission Tiers

| Action                          | Tier | Rule                     |
| ------------------------------- | ---- | ------------------------ |
| Research, browse, compare       | 0    | Just do it               |
| Save reports to knowledge files | 0    | Just do it               |
| Send alerts via Telegram        | 1    | Do it (that's the point) |
| Recommend price changes         | 1    | Report to Francisco      |
| Actually change our prices      | 2    | Confirm with Francisco   |

## Schedule

- **Weekly**: Full competitor audit (all known competitors)
- **Before each new listing**: Quick competitor price check
- **On demand**: When Francisco asks about competition
- **Continuous**: Watch for Telegram alerts about market changes
