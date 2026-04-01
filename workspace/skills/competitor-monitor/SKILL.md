---
name: competitor-monitor
description: "Monitor DressLikeMommy competitors for price changes, new products, and market trends. Use when: (1) Scheduled competitor check, (2) Francisco asks about competition, (3) Before pricing a new product, (4) Market research tasks."
---

# Competitor Monitor

Track competitor stores, prices, and trends to keep DressLikeMommy competitive.

## Known Competitors

Check and update `knowledge/business/competitor-*.md` files for current list. Key competitors include:

- **PatPat** -- Large mommy-and-me retailer, aggressive pricing
- **SHEIN** -- Fast fashion, very low prices (hard to compete on price alone)
- **Amazon sellers** -- Various mommy-and-me shops
- **Etsy shops** -- Handmade/boutique matching outfits
- **Other Shopify stores** -- Google "[product] mommy and me matching"

## Trigger Conditions

When to invoke this skill:

- Scheduled weekly competitor audit fires
- Francisco asks about competition, pricing landscape, or market trends
- Before pricing a new product listing (quick competitor price check)
- A new competitor is discovered or mentioned
- Alert from external source about market changes

## Required Inputs

| Input       | Source                                       | Required                | Example                              |
| ----------- | -------------------------------------------- | ----------------------- | ------------------------------------ |
| operation   | User message or schedule                     | Yes                     | "full audit", "price check", "trend" |
| competitors | `knowledge/business/competitor-*.md` or user | No (default: all known) | "PatPat only"                        |
| product     | User message                                 | For price check         | "matching floral dress"              |
| date_range  | User or default (last 7 days)                | No                      | "2026-03-01 to 2026-03-31"           |

## Data Collection Steps

1. **Load competitor list** -- tool: `read`
   - Read `knowledge/business/competitor-*.md` for current URLs and tracking notes
   - Expected: list of competitor stores with last-checked dates
   - If files missing: use hardcoded known competitors list above

2. **Visit competitor sites** -- tool: `browser`
   - Navigate to each competitor's new arrivals / relevant category page
   - Expected: page loads with product listings visible
   - If site blocks automated access: try `web_fetch` instead; if both fail, skip and note

3. **Extract pricing and product data** -- tool: `browser` (JS extraction) or `web_fetch`
   - Scrape: product names, prices, discount indicators, new arrival flags
   - Expected: structured data for at least 10 products per competitor
   - If extraction returns empty: screenshot page for manual review, flag

4. **Compare against our catalog** -- tool: `read`
   - Cross-reference competitor products with our Shopify listings
   - Identify: products they have that we don't, price differences on similar items
   - Expected: comparison table with gaps and opportunities

5. **Detect trends** -- tool: `web_search`
   - Search for "mommy and me" trending products, seasonal shifts
   - Check Google Trends, social media buzz
   - Expected: 2-3 trend signals with supporting evidence

6. **Save findings** -- tool: `write`
   - Update `knowledge/business/competitor-*.md` with new data
   - Expected: files updated with current date and findings

7. **Send alerts if triggered** -- tool: `message send`
   - Check alert triggers (see below); send Telegram if any fire
   - Expected: alert sent with actionable details

## Alert Triggers

Send Telegram alert when:

- A competitor drops prices significantly (>20% on items we also sell)
- A new competitor appears with strong overlap in our niche
- A trending product emerges that we don't carry
- A competitor runs a major promotion or campaign

## Output Format

### Deliverable: Competitor Report

Delivery method: Telegram summary + file
File path: `knowledge/business/competitor-report-YYYY-MM-DD.md`

```
**Competitor Check -- [Date]**

**[Competitor Name]**
- New products: [count] | Price range: $[X]-$[Y]
- Notable: [any significant change]
- vs Us: [how we compare]
- Source: [URL] | Checked: [timestamp]

**Opportunities**
- [Product/trend we should consider] [Source: URL]
- [Price adjustment suggestions] [verified/estimated]

**Threats**
- [Competitor moves that could impact us] [Source: URL]
```

### Deliverable: Price Alert

Delivery method: Telegram (immediate)

```
PRICE ALERT: [Competitor] now sells [product] at $[X]
Our price: $[Y] | Our cost: $[Z]
Source: [URL] | Checked: [timestamp]
Action needed: [recommendation]
```

## Success Criteria

- [ ] All known competitors checked (or failures documented)
- [ ] Price data extracted for at least 80% of target competitors
- [ ] Comparison against our catalog completed
- [ ] Findings saved to `knowledge/business/` with current date
- [ ] Alert triggers evaluated; alerts sent if conditions met
- [ ] All data points have source URLs and timestamps

## Error Handling

| Failure                 | Detection                          | Response                                                |
| ----------------------- | ---------------------------------- | ------------------------------------------------------- |
| Competitor site blocked | 403/captcha/empty page             | Try `web_fetch`; if fails, skip competitor and note     |
| Site layout changed     | JS extraction returns empty        | Screenshot for manual review; use `web_search` fallback |
| Price data inconsistent | Prices seem wrong (e.g., $0, $999) | Flag as [unconfirmed]; do not use for comparisons       |
| Knowledge files missing | File read returns not found        | Use hardcoded competitor list; create files on save     |
| Telegram send fails     | Exit code != 0                     | Retry once; save alert to file and log                  |

## Evidence Standards

- Every price point must include source URL and scrape timestamp
- Distinguish between regular price, sale price, and clearance price
- Use confidence tags: [verified] (directly scraped), [estimated] (inferred from similar), [unconfirmed] (data looks off)
- Flag data older than 7 days as potentially stale
- Note when a competitor site could not be fully scraped (partial data)
- Never present estimated competitor prices as confirmed facts

## Schedule

- **Weekly**: Full competitor audit (all known competitors)
- **Before each new listing**: Quick competitor price check
- **On demand**: When Francisco asks about competition
- **Continuous**: Watch for Telegram alerts about market changes

## Permission Tiers

| Action                          | Tier | Rule                     |
| ------------------------------- | ---- | ------------------------ |
| Research, browse, compare       | 0    | Just do it               |
| Save reports to knowledge files | 0    | Just do it               |
| Send alerts via Telegram        | 1    | Do it (that's the point) |
| Recommend price changes         | 1    | Report to Francisco      |
| Actually change our prices      | 2    | Confirm with Francisco   |
