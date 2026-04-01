---
name: supplier-scout
description: "Scout products on 1688.com using JS extraction (zero screenshots). Use when: finding new products, comparing suppliers, vetting vendors, sourcing alternatives."
---

# Supplier Scout

Find and filter products on 1688.com for DressLikeMommy. **Data extraction only -- human does visual review.**

## Business Context

- **Niche**: Mommy and me / family matching outfits
- **Source**: 1688.com (Chinese wholesale)
- **Fulfillment**: BuckyDrop -> YunExpress -> USA
- **Margin rule**: >=50% profit after ALL costs (product + shipping + fees + marketing)

## Trigger Conditions

When to invoke this skill:

- Francisco asks to find new products or source items for a category
- A new trend is identified (by competitor-monitor or content-publisher) that we don't carry
- An existing product's supplier becomes unreliable and alternatives are needed
- Scheduled product scouting run fires
- Francisco says "scout", "find products", "source", or mentions 1688

## Required Inputs

| Input       | Source                           | Required | Example                          |
| ----------- | -------------------------------- | -------- | -------------------------------- |
| category    | User message                     | Yes      | "matching swimwear"              |
| keywords_cn | Auto-translated or user          | No       | "亲子泳衣"                       |
| min_margin  | Default (50%) or user override   | No       | "60%"                            |
| vendor_min  | Default (6/10) or user override  | No       | "8" (stricter vetting)           |
| seen_urls   | `knowledge/1688-seen-urls.jsonl` | Auto     | (loaded automatically for dedup) |

## Method: JS DOM Extraction (NOT Screenshots)

**Why:** Screenshots cost ~2,000 tokens each. JS extraction costs ~200-500 tokens per page and returns structured data. For scouting 10 pages (~400 products), that's 3-5K tokens vs 50-100K.

## Data Collection Steps

1. **Navigate to search** -- tool: `browser`
   - URL: `https://s.1688.com/selloffer/offer_search.htm?keywords=亲子装+[category]&sortType=va_rmdarkgmv30rt`
   - Common keywords: 亲子装 (parent-child), 亲子连衣裙 (dresses), 亲子泳衣 (swimwear), 亲子运动套装 (athleisure), 亲子睡衣 (pajamas), 母女装 (mother-daughter)
   - Expected: search results page loads with product cards
   - If captcha blocks: see Error Handling

2. **Extract product data (JavaScript)** -- tool: `browser` (JS execution)
   - Execute DOM extraction script on search results page
   - Adapt selectors to current 1688 DOM (changes periodically)
   - Expected: JSON array of {title, price, sales, vendor, link}
   - If selectors return empty: take ONE screenshot to inspect current structure, update selectors, retry

   ```javascript
   (() => {
     const items = document.querySelectorAll(
       '[class*="offer-list"] [class*="card"], .sm-offer-item',
     );
     return Array.from(items)
       .map((el) => {
         const title = el.querySelector('[class*="title"], .title')?.textContent?.trim() || "";
         const price = el.querySelector('[class*="price"], .price')?.textContent?.trim() || "";
         const sales =
           el.querySelector('[class*="sale"], [class*="deal"]')?.textContent?.trim() || "";
         const vendor =
           el.querySelector('[class*="company"], [class*="seller"]')?.textContent?.trim() || "";
         const link = el.querySelector('a[href*="detail.1688.com"]')?.href || "";
         return { title, price, sales, vendor, link };
       })
       .filter((x) => x.link);
   })();
   ```

3. **Score vendors** -- tool: `browser` (JS extraction on vendor pages)
   - For each candidate, check vendor page for rating, sales, store age, response rate, stock
   - Scoring: 8-10 Excellent, 6-7 Acceptable, 4-5 Risky (flag), 0-3 REJECT
   - See `procedures/vendor-vetting.md` for detailed checks
   - If vendor page fails to load: score as 0 with note "unverifiable"

   | Factor    | 0 pts       | 1 pt     | 2 pts  |
   | --------- | ----------- | -------- | ------ |
   | Rating    | <4.0        | 4.0-4.4  | 4.5+   |
   | Sales     | None        | Some     | Active |
   | Store Age | <1yr        | 1-3yr    | 3+yr   |
   | Response  | <80%        | 80-90%   | 90%+   |
   | Stock     | Low/unclear | Moderate | Plenty |

4. **Deduplicate** -- tool: `read`
   - Load `knowledge/1688-seen-urls.jsonl`
   - Filter out any extracted URL already in the file
   - This prevents resurfacing products Francisco already reviewed
   - If file missing: proceed without dedup; create file in step 7

5. **Filter candidates** -- tool: native
   - Must have: adult AND child sizes in same listing, matching design, vendor score >= 6, estimated margin >= 50%, recent listing
   - Expected: filtered list of viable products
   - If zero candidates pass: widen margin to 40% and re-filter; report relaxed criteria

6. **Output ranked table** -- tool: `write` / task card
   - Write ranked table to task card, move card to `human` lane
   - Expected: table with product name, price, margin estimate, vendor score, link

7. **Log seen URLs** -- tool: `write`
   - Append ALL extracted URLs to `knowledge/1688-seen-urls.jsonl`
   - Outcomes: `presented`, `filtered`, `approved`, `rejected`
   - Expected: file updated with new entries

## Alternative Sourcing

When an existing product's supplier becomes unreliable:

1. Search 1688 for same/similar product (use product image search if available)
2. Compare: price, quality indicators, delivery time
3. Present top 3 alternatives with cost comparison
4. Flag to Francisco for decision

## Output Format

### Deliverable: Scouting Report

Delivery method: Task card (moved to `human` lane) + Telegram summary
File path: `knowledge/scouting/scout-YYYY-MM-DD-[category].md`

```
**Supplier Scout -- [Date] -- [Category]**

**Search:** [keywords used] | **Pages scanned:** [N] | **Products extracted:** [N]
**After dedup:** [N] | **After filtering:** [N]

| # | Product | Price | Est. Margin | Vendor Score | Link |
|---|---------|-------|-------------|-------------|------|
| 1 | [Name]  | [CNY] | ~[X]%       | [X]/10      | [->](url) |

**Rejected (top reasons):**
- [N] below margin threshold
- [N] vendor score too low
- [N] already seen

**Notes:** [any observations about market, pricing trends, etc.]
```

## Success Criteria

- [ ] Search executed for target category with correct Chinese keywords
- [ ] JS extraction returned product data (>0 results)
- [ ] Vendor scoring completed for all candidates above initial filter
- [ ] Deduplication applied against `knowledge/1688-seen-urls.jsonl`
- [ ] At least 1 product passed all filters (or relaxed criteria documented)
- [ ] Ranked table delivered to human lane
- [ ] All extracted URLs logged to seen-urls file
- [ ] Telegram summary sent to Francisco

## Error Handling

| Failure                    | Detection                             | Response                                                                                           |
| -------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Captcha / login wall       | Page shows captcha instead of results | Use saved search URLs; navigate manually then run JS; mark task blocked with `BlockerType=Captcha` |
| JS selectors return empty  | Extraction returns 0 products         | Take ONE screenshot, inspect DOM, update selectors, retry once                                     |
| 1688 page won't load       | Timeout or connection error           | Retry once after 30s; if still fails, abort and notify                                             |
| Vendor page inaccessible   | 404 or timeout on vendor URL          | Score as 0 ("unverifiable"); exclude from recommendations                                          |
| Seen-urls file missing     | File not found error                  | Proceed without dedup; create file in logging step                                                 |
| Zero products pass filters | Filtered list is empty                | Widen margin to 40%, re-filter; if still empty, report "no viable products"                        |
| Price parsing fails        | Price field contains non-numeric      | Flag product as [unconfirmed price]; exclude from margin calc                                      |

## Evidence Standards

- Every product recommendation must include direct 1688 URL
- Prices must note currency (CNY) and extraction timestamp
- Margin estimates must show calculation: (retail price - total cost) / retail price
- Total cost must include: product + estimated shipping + platform fees
- Vendor scores must show individual factor breakdown, not just total
- Use confidence tags: [verified] (data from page), [estimated] (calculated), [unconfirmed] (parsing uncertain)
- Flag any product with incomplete data (missing sizes, unclear pricing tiers)
- Distinguish between "minimum order" price and "single unit" price

## Permission Tiers

| Action                            | Tier       | Rule                       |
| --------------------------------- | ---------- | -------------------------- |
| Research, browse, extract data    | 0          | Just do it                 |
| Save findings to workspace        | 0          | Just do it                 |
| Recommend products (ranked table) | 1          | Do it, report to Francisco |
| Import to BuckyDrop               | 1          | Do it, report after        |
| Commit to new supplier            | 2          | Confirm with Francisco     |
| Publish listing (Draft -> Active) | HUMAN ONLY | Francisco does this        |
