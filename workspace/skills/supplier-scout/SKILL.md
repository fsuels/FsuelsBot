---
name: supplier-scout
description: "Scout products on 1688.com using JS extraction (zero screenshots). Use when: finding new products, comparing suppliers, vetting vendors, sourcing alternatives."
---

# Supplier Scout

Find and filter products on 1688.com for DressLikeMommy. **Data extraction only — human does visual review.**

## Business Context

- **Niche**: Mommy and me / family matching outfits
- **Source**: 1688.com (Chinese wholesale)
- **Fulfillment**: BuckyDrop → YunExpress → USA
- **Margin rule**: ≥50% profit after ALL costs (product + shipping + fees + marketing)

## Method: JS DOM Extraction (NOT Screenshots)

**Why:** Screenshots cost ~2,000 tokens each. JS extraction costs ~200-500 tokens per page and returns structured data. For scouting 10 pages (~400 products), that's 3-5K tokens vs 50-100K.

**How:** Navigate to 1688 search URL → execute JavaScript → get JSON array of product data → filter → score → output ranked table.

### Step 1: Navigate

```
https://s.1688.com/selloffer/offer_search.htm?keywords=亲子装+[category]&sortType=va_rmdarkgmv30rt
```

Common category keywords:

- 亲子装 (parent-child outfit — base term)
- 亲子连衣裙 (matching dresses)
- 亲子泳衣 (matching swimwear)
- 亲子运动套装 (matching athleisure)
- 亲子睡衣 (matching pajamas)
- 母女装 (mother-daughter)

### Step 2: Extract Data (JavaScript)

Execute on search results page. Adapt selectors to current 1688 DOM:

```javascript
// Extract product data from 1688 search results
// Selectors may need updating — 1688 changes their DOM periodically
(() => {
  const items = document.querySelectorAll('[class*="offer-list"] [class*="card"], .sm-offer-item');
  return Array.from(items)
    .map((el) => {
      const title = el.querySelector('[class*="title"], .title')?.textContent?.trim() || "";
      const price = el.querySelector('[class*="price"], .price')?.textContent?.trim() || "";
      const sales = el.querySelector('[class*="sale"], [class*="deal"]')?.textContent?.trim() || "";
      const vendor =
        el.querySelector('[class*="company"], [class*="seller"]')?.textContent?.trim() || "";
      const link = el.querySelector('a[href*="detail.1688.com"]')?.href || "";
      return { title, price, sales, vendor, link };
    })
    .filter((x) => x.link);
})();
```

**Important:** 1688 frequently changes their DOM structure. If selectors return empty, take ONE screenshot to inspect current structure, update selectors, then continue with JS extraction.

### Step 3: Score Vendors

For each candidate, check vendor page (also via JS extraction):

| Factor    | 0 pts       | 1 pt     | 2 pts  |
| --------- | ----------- | -------- | ------ |
| Rating    | <4.0        | 4.0-4.4  | 4.5+   |
| Sales     | None        | Some     | Active |
| Store Age | <1yr        | 1-3yr    | 3+yr   |
| Response  | <80%        | 80-90%   | 90%+   |
| Stock     | Low/unclear | Moderate | Plenty |

- **8-10:** Excellent ✅
- **6-7:** Acceptable ⚠️
- **4-5:** Risky — flag to Francisco
- **0-3:** REJECT

See `procedures/vendor-vetting.md` for detailed checks and fallacy prevention.

### Step 4: Dedupe

Before filtering, remove already-seen URLs:

1. Load `knowledge/1688-seen-urls.jsonl`
2. Filter out any extracted URL that already appears in the file
3. This prevents resurfacing products Francisco already reviewed

### Step 5: Filter

Must have:

- Adult AND child sizes in same listing
- Matching design (same fabric/pattern)
- Vendor score ≥ 6
- Estimated margin ≥ 50% (product price × ~3 < typical retail)
- Recent listing (not stale/discontinued)

### Step 6: Output Ranked Table

Write to task card, then move card to `human` lane:

```
| # | Product | ¥ Price | Est. Margin | Vendor Score | Link |
|---|---------|---------|-------------|-------------|------|
| 1 | [Name] | ¥XX | ~XX% | X/10 | [→](url) |
```

### Step 7: Log Seen URLs

Append ALL extracted URLs (not just passed ones) to `knowledge/1688-seen-urls.jsonl`:

```json
{
  "url": "https://detail.1688.com/...",
  "date": "2026-02-21",
  "outcome": "presented",
  "category": "matching dresses"
}
```

Outcomes: `presented` (shown to Francisco), `filtered` (failed checks), `approved` (Francisco picked), `rejected` (Francisco skipped).

Francisco clicks links, marks YES/NO, AI proceeds with approved picks.

## Alternative Sourcing

When an existing product's supplier becomes unreliable:

1. Search 1688 for same/similar product (use product image search if available)
2. Compare: price, quality indicators, delivery time
3. Present top 3 alternatives with cost comparison
4. Flag to Francisco for decision

## Captcha / Login Issues

1688 may block automated search with captcha. Fallbacks:

1. Use saved search URLs from previous sessions
2. Navigate manually in browser, then run JS on loaded page
3. Mark task as blocked, `BlockerType=Captcha`, move to `human` lane

## Permission Tiers

| Action                            | Tier       | Rule                       |
| --------------------------------- | ---------- | -------------------------- |
| Research, browse, extract data    | 0          | Just do it                 |
| Save findings to workspace        | 0          | Just do it                 |
| Recommend products (ranked table) | 1          | Do it, report to Francisco |
| Import to BuckyDrop               | 1          | Do it, report after        |
| Commit to new supplier            | 2          | Confirm with Francisco     |
| Publish listing (Draft → Active)  | HUMAN ONLY | Francisco does this        |
