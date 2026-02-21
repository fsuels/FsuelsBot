# Product Listing Procedure v3.0 — AI/Human Split

_Updated: 2026-02-21_

**Core principle:** AI does data work (cheap tokens). Human does visual work (instant, free). Never mix them.

---

## HARD RULES

1. **AI never publishes.** AI creates Shopify DRAFTS only. Francisco activates.
2. **No Shopify draft until BuckyDrop costs extracted.** Hard dependency.
3. **50% profit after ALL costs** (product + shipping + fees + marketing). Non-negotiable.
4. **Zero screenshots in discovery.** JS extraction only.
5. **Ledger is truth.** Not memory, not chat. Ledger.

---

## THE PIPELINE

```
AI PHASE 1: SCOUT ──→ HUMAN: PICK ──→ AI PHASE 2: COST & PRICE ──→ HUMAN: PRICE ──→ AI PHASE 3: DRAFT ──→ HUMAN: ACTIVATE
   (bot_current)      (human lane)         (bot_current)             (human lane)       (bot_current)        (human lane)
    ~3-5K tokens        0 tokens             ~10-15K tokens            0 tokens           ~15-20K tokens        0 tokens
```

---

## AI PHASE 1: SCOUT

**Lane:** `bot_current`
**Token budget:** ~3-5K for 10 pages of results
**Method:** JavaScript DOM extraction — ZERO screenshots

### What AI does:

1. **Dedupe check** — Search Shopify for existing products matching the search term. Skip duplicates.
2. **Navigate 1688.com** — Use search URL with Chinese keywords for target category
3. **JS extraction per results page** — One JavaScript call extracts structured data:
   ```
   [{title, price_cny, vendor_rating, vendor_years, sales_count,
     moq, has_child_sizes, has_adult_sizes, listing_date, url}, ...]
   ```
4. **Score vendors** — Apply 5-point system (see `procedures/vendor-vetting.md`):
   - Rating ≥ 4.0 (prefer 4.5+)
   - Active recent sales
   - Store age 1+ years
   - Response rate 90%+
   - Stock available + 1-piece dropshipping
5. **Filter products** — Must have adult AND child sizes, matching design, reasonable base cost
6. **Estimate margin** — Quick calc: product price × ~3 (estimated total cost multiplier) vs typical retail
7. **Paginate** — Repeat extraction across multiple pages
8. **Produce ranked output** — Table of candidates sorted by estimated margin

### Output (written to task card):

```markdown
## Scout Complete — [Category] — [Date]

Scanned: [X] products across [Y] pages
Passed filters: [N] products

| #   | Product            | ¥ Price | Est. Cost | Est. Margin | Vendor Score | Link     |
| --- | ------------------ | ------- | --------- | ----------- | ------------ | -------- |
| 1   | Red Heart Fleece   | ¥37     | ~$15      | ~65%        | 9/10         | [→](url) |
| 2   | Boho Chiffon Dress | ¥64     | ~$18      | ~60%        | 8/10         | [→](url) |
| ... |

**Your action:** Click each link, check photos/style fit. Reply with numbers to proceed (e.g., "1, 3, 5, 8").
```

### Then: Card moves to `human` lane.

---

## HUMAN CHECKPOINT 1: PICK

**Lane:** `human`
**Time:** ~2-3 minutes for 10-15 links

### What Francisco does:

1. Click each 1688 link in the table
2. Visual check: Do the photos look good? Does the style fit DLM brand?
3. Reply with product numbers to proceed: "1, 3, 5, 8"
4. Optionally note concerns: "3 looks cheap, skip" or "8 only if in red"

### Then: Card moves back to `bot_queue` with picks noted.

---

## AI PHASE 2: COST & PRICE

**Lane:** `bot_current`
**Token budget:** ~10-15K (browser work with BuckyDrop)
**Method:** Browser automation for BuckyDrop, web search for competitors

### What AI does (for each approved product):

1. **Import to BuckyDrop** — Paste 1688 URL, import product
2. **Extract FULL cost breakdown:**
   - Product price (from 1688)
   - Domestic shipping (factory → BuckyDrop warehouse)
   - International shipping (YunExpress → USA)
   - BuckyDrop platform fees
   - Value-added services
3. **Extract product weight** (adult size) — needed for shipping calc
4. **Add marketing allocation** — 15% of subtotal
5. **Calculate total cost** — Sum of ALL above
6. **Calculate minimum price** — Total cost ÷ 0.5 = price for 50% profit
7. **Research competitors** — Search Amazon, Etsy, Google Shopping for similar products
8. **Recommend price** — Competitive AND ≥ 50% profit after all costs

### Output (written to task card):

```markdown
## Cost & Price Report — [Date]

| Product          | Cost Breakdown                                                | Total  | Min Price (50%) | Competitors | Recommended       |
| ---------------- | ------------------------------------------------------------- | ------ | --------------- | ----------- | ----------------- |
| Red Heart Fleece | prod $5.42 + dom $0.84 + intl $6.56 + fees $2.61 + mktg $2.31 | $17.74 | $35.48          | $22-39      | $34.99 (49.3%)    |
| Boho Dress       | prod $8.98 + dom $1.20 + intl $7.80 + fees $3.10 + mktg $3.16 | $24.24 | $48.48          | $28-45      | $44.99 (46.1%) ⚠️ |

### Detail: Red Heart Fleece Hoodie

├── Product: $5.42 (¥37 × 0.1465)
├── Domestic: $0.84
├── Intl (Yun): $6.56
├── BD fees: $2.61
├── Marketing: $2.31 (15%)
├── TOTAL COST: $17.74
├── Min price: $35.48 (50% profit)
├── Competitors: $22.99 - $38.99 (Amazon/Etsy avg $29.99)
└── RECOMMENDED: $34.99 (margin: 49.3%)

⚠️ Boho Dress: competitors top at $45, but 50% margin needs $48.48.
Options: find cheaper source, accept 40% margin, or skip.

**Your action:** Approve prices or adjust. Drop any that don't work.
```

### Then: Card moves to `human` lane.

---

## HUMAN CHECKPOINT 2: PRICE APPROVAL

**Lane:** `human`
**Time:** ~1-2 minutes

### What Francisco does:

1. Review cost breakdowns — are they complete?
2. Check competitor data — does the price make sense in market?
3. Approve, adjust, or drop each product
4. Reply: "All approved" or "Drop #2, adjust #1 to $32.99"

### Then: Card moves back to `bot_queue` with approved prices.

---

## AI PHASE 3: CREATE DRAFT

**Lane:** `bot_current`
**Token budget:** ~15-20K (Shopify browser work)
**Method:** Browser automation for Shopify Admin

### What AI does (for each approved product):

1. **Create new product in Shopify Admin** (admin.shopify.com)
2. **Fill all fields:**
   - **Title:** SEO-friendly, ≤60 chars
   - **Description:** Benefits, materials, sizing — English-native, brand-appropriate
   - **Product type:** Set correctly
3. **Category metafields:** Color, Size, Fabric, Age group, Target gender
4. **Product metafields:** Pattern, Style, Type, SubCategory
5. **Tags:** color + collection + relationship + brand + product type
6. **Collections:** "Mommy and Me" (always) + seasonal + category
7. **Images:** Upload all product images from 1688
8. **Size chart:** Extract from 1688 data, convert sizes (Kids: 80-150cm, Adults: S-3XL)
9. **Variants:** All sizes with APPROVED price
10. **Save as DRAFT** — NEVER publish active

### Output (written to task card):

```markdown
## Drafts Created — [Date]

| Product          | Draft URL     | Price  | Margin | Images     | Tags   | Size Chart |
| ---------------- | ------------- | ------ | ------ | ---------- | ------ | ---------- |
| Red Heart Fleece | [admin→](url) | $34.99 | 49.3%  | 6 uploaded | 8 tags | ✅         |
| ...              |

**Your action:**

- [ ] Check each draft visually
- [ ] Face swap needed? (Chinese faces → American faces)
- [ ] Approve and publish: Draft → Active
```

### Then: Card moves to `human` lane.

---

## HUMAN CHECKPOINT 3: ACTIVATE

**Lane:** `human`
**Time:** ~5 minutes per product

### What Francisco does:

1. Open each draft URL in Shopify Admin
2. Visual QA: photos look good? Description reads well? Price correct?
3. Face swap if needed (aifaceswap.io or similar)
4. **Publish:** Change status from Draft → Active
5. Only Francisco can do this step. AI cannot.

### Then: Card moves to `done_today` lane.

---

## LEDGER TRACKING

### Required fields per product:

| Field            | Purpose                              |
| ---------------- | ------------------------------------ |
| product          | Name                                 |
| 1688_url         | Source link                          |
| phase            | scout / cost / draft / active        |
| status           | pending / in_progress / human / done |
| vendor_score     | 0-10 from vetting                    |
| weight_g         | For shipping calc                    |
| cost_breakdown   | product + dom + intl + fees + mktg   |
| total_cost       | Sum of all costs                     |
| competitor_range | "$X - $Y (source)"                   |
| approved_price   | Francisco's final price              |
| margin_pct       | Calculated profit %                  |
| draft_url        | Shopify draft URL                    |
| notes            | Free-form                            |

### State saves:

Write to `memory/tasks/<task-id>.md` after each AI phase completes.
On resume: read task card → continue from current phase. Never rely on memory.

---

## BATCH RULES

| Phase        | Batch Size                            | Why                             |
| ------------ | ------------------------------------- | ------------------------------- |
| Scout        | Full search (40-100 products scanned) | JS extraction is cheap          |
| Cost & Price | 3-5 products per session              | BuckyDrop browser work is heavy |
| Create Draft | 3-5 products per session              | Shopify browser work is heavy   |

---

## TOKEN BUDGET SUMMARY

| Phase     | Method            | Tokens      | Old Method        | Old Tokens    |
| --------- | ----------------- | ----------- | ----------------- | ------------- |
| Scout     | JS extraction     | ~3-5K       | Screenshots + DOM | ~50-100K      |
| Cost      | BuckyDrop browser | ~10-15K     | Same              | ~15-20K       |
| Draft     | Shopify browser   | ~15-20K     | Full snapshots    | ~50-80K       |
| **TOTAL** |                   | **~30-40K** |                   | **~115-200K** |

**4-5x cheaper. Same output. Better quality.**

---

## COMMON MISTAKES

❌ Taking screenshots to "see" products on 1688
❌ Starting Shopify draft before BuckyDrop costs extracted
❌ Pricing without competitor research
❌ Publishing active instead of draft
❌ Accepting < 50% margin without flagging
❌ Leaving Chinese faces in photos
❌ Relying on memory instead of ledger/task card

✅ JS extraction for data, zero screenshots
✅ Full cost breakdown including marketing allocation
✅ Competitor research on every product
✅ Always DRAFT, Francisco publishes
✅ 50% profit after ALL costs or flag it
✅ Update ledger after every step
