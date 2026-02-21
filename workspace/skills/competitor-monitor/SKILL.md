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

- **Full Audit**: Visit competitors, check new arrivals + pricing + promos, compare to our catalog, save to `knowledge/business/`
- **Price Watch**: Find competitor prices for same/similar items, flag if cheaper than our minimum
- **Trend Detection**: Spot mommy-and-me trends we don't carry yet
- **New Competitors**: Search Google Shopping/Etsy/Amazon for new sellers in our niche

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
