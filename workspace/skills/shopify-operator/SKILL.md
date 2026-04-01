---
name: shopify-operator
description: "Manage DressLikeMommy Shopify store. Use when: (1) Creating/editing product listings, (2) Checking inventory or orders, (3) Updating prices or collections, (4) SEO optimization, (5) Inventory monitoring & alerts, (6) Any task involving admin.shopify.com. Uses browser automation + Shopify CLI."
version: 2.0.0
metadata: { "clawdbot": { "emoji": "S", "requires": { "bins": ["moltbot"] } } }
---

# Shopify Operator v2.0

Manages the DressLikeMommy Shopify store end-to-end: product CRUD, pricing with safety rails, inventory monitoring, order management, and SEO. Every mutation is logged, verified, and reversible.

## Store Context

- **Store**: DressLikeMommy (mommy-and-me / family matching outfits)
- **Store handle**: `dresslikemommy-com` (NOT `dresslikemommy`)
- **Admin URL**: `admin.shopify.com`
- **Fulfillment**: BuckyDrop (dropship from 1688 suppliers)
- **Pricing rule**: MINIMUM = Total Cost x 2 (50% margin floor). See `procedures/pricing.md`
- **Listing pipeline**: See `procedures/product-listing.md` (3-phase AI/Human split)
- **Size charts**: See `procedures/size-chart-guide.md` (extraction, conversion, HTML template)
- **Audit log**: `workspace/memory/shopify-audit.jsonl`

## Trigger Conditions

- Explicit: User asks to create/edit/check products, prices, inventory, orders, or SEO
- Explicit: User asks about store performance, sales data, or stock levels
- Implicit: Inventory drops below low-stock threshold (if monitoring active)
- Implicit: Price change requested that exceeds safety bounds

## Required Inputs

| Input         | Source                         | Required          | Example                       |
| ------------- | ------------------------------ | ----------------- | ----------------------------- |
| product_id    | User message or Shopify search | Varies            | `8234567890123`               |
| product_title | User message                   | Varies            | "Red Heart Fleece Hoodie Set" |
| price         | User or pricing procedure      | For pricing ops   | `34.99`                       |
| reason        | User message or context        | For price changes | "Competitor undercut by 15%"  |

## Tools Used

- `browser` -- Navigate Shopify admin, fill forms, upload images (Claude_in_Chrome preferred)
- `web_search` -- Competitor pricing, SEO keyword research
- `exec` -- Shopify CLI commands, curl API calls
- `write` / `edit` -- Update audit log, knowledge files
- `moltbot message send` -- Telegram alerts for inventory/order notifications

---

## Permission Tiers

| Action                                        | Tier | Rule                      |
| --------------------------------------------- | ---- | ------------------------- |
| Read store data, audit, research, SEO audit   | 0    | Just do it                |
| Edit drafts, update SEO, fix data, add tags   | 1    | Do it, report after       |
| Price adjustments within +/-10% on live items | 1    | Do it, log + report after |
| Price adjustments beyond +/-10%               | 2    | Confirm with Francisco    |
| Publish products (Draft -> Active)            | 2    | Confirm with Francisco    |
| Delete products                               | 2    | Confirm with Francisco    |
| Change store settings, theme, checkout        | 2    | Confirm with Francisco    |

---

## API Error Handling

Every Shopify API call or browser-automated action must follow this error protocol.

### Rate Limit (HTTP 429)

```
Retry strategy: exponential backoff with jitter
  Attempt 1: wait 1s + random(0-500ms)
  Attempt 2: wait 2s + random(0-1000ms)
  Attempt 3: wait 4s + random(0-2000ms)
  Max retries: 3
  After 3 failures: log to audit, queue action for later, report to Francisco
```

### Product Not Found (HTTP 404)

```
1. Verify the product ID is correct (check for typos, stale IDs)
2. Search by product title in Shopify admin
3. Check if product was archived or deleted (search "All" status filter)
4. If truly missing: log to audit with context, report to Francisco
   -- NEVER silently skip a missing product
```

### Conflict (HTTP 409)

```
1. Re-fetch the current product state from Shopify
2. Compare fetched state with intended changes
3. Merge non-conflicting fields
4. Re-apply the update with fresh data
5. If conflict persists after 1 retry: log and escalate to Francisco
```

### Auth Failure (HTTP 401 / 403)

```
1. Log the failure with timestamp and endpoint
2. DO NOT retry (credentials won't fix themselves)
3. Check: is the browser session still logged in?
4. If browser session expired: re-authenticate via browser
5. If API token issue: report to Francisco immediately
   -- NEVER expose or log the actual credentials
```

### Network Timeout

```
1. Retry once after 5s wait
2. If second attempt also times out:
   a. Log the failed operation with full context (product ID, intended changes)
   b. Queue for later retry (write to workspace/memory/shopify-retry-queue.jsonl)
   c. Report: "Shopify unreachable -- queued [action] for retry"
3. On next skill invocation: check retry queue first, process any pending items
```

### Browser Automation Failures

```
1. If Shopify admin page doesn't load: retry navigation once
2. If element not found: check for Shopify UI updates (selectors may change)
3. If iframe blocks interaction: use JS property setter + dispatch events
4. If stuck > 2 minutes on one action: fall back to CLI/API approach
5. Follow TOOLS.md fallback chain: Claude_in_Chrome -> Control_Chrome -> osascript -> Peekaboo
```

---

## Price Change Safety Protocol

### Pre-Change Validation

Before ANY price modification on a live product:

1. **Read current price** from Shopify (the source of truth, not memory)
2. **Calculate change magnitude**: `abs(new_price - old_price) / old_price * 100`
3. **Check permission tier**:
   - Change <= 10%: Tier 1 (proceed, log + report after)
   - Change > 10%: Tier 2 (prepare change, present to Francisco for approval)
4. **Verify margin**: new price must still meet `Total Cost x 2` minimum
   - If new price < minimum: BLOCK the change, report the margin violation
5. **Require a reason**: every price change must have a documented reason

### Execution

```
1. Record BEFORE state:
   {product_id, product_title, old_price, old_compare_at_price, timestamp}

2. Apply the price change via Shopify admin or API

3. Read-back verification (MANDATORY):
   - Re-fetch the product from Shopify
   - Confirm new_price matches what was intended
   - Confirm compare_at_price is still correct (if applicable)
   - If mismatch detected: ROLLBACK immediately (set price back to old_price)

4. Log to audit:
   {"action": "price_change", "product_id": "...", "product_title": "...",
    "old_price": 34.99, "new_price": 31.99, "change_pct": -8.6,
    "reason": "Competitor price drop on Amazon",
    "tier": 1, "verified": true, "timestamp": "2026-03-31T14:22:00Z"}
```

### Rollback Procedure

If a wrong price is detected (by read-back or later audit):

1. Immediately set price back to the last known-good value from the audit log
2. Verify the rollback via read-back
3. Log the rollback event with reason
4. Alert Francisco via Telegram: "Price rollback on [product]: $X.XX -> $Y.YY (was wrong, reverted)"

### Bulk Price Changes

- Maximum 5 products per batch
- Each product follows the full safety protocol individually
- If ANY product in the batch fails validation, the entire batch pauses
- Report partial results: "Changed 3/5. Blocked: [product] (margin violation), [product] (>10% change needs approval)"

---

## Product Update Workflow

### Pre-Flight (before any mutation)

1. **Verify product exists**: fetch by ID or search by title
2. **Record current state**: capture all fields that will be modified
3. **Check inventory status**: is the product in stock? Any pending orders?
4. **Check product status**: Draft vs Active -- different permission tiers apply
5. **For pricing changes**: run Price Change Safety Protocol (above)

### Execute

1. Apply changes via Shopify admin browser automation or API
2. For multi-field updates: apply all changes before saving (one save operation)
3. For React/Shopify inputs that resist standard typing: use JS property setter + dispatch `input`/`change` events (per TOOLS.md anti-patterns)

### Post-Flight (MANDATORY after every mutation)

1. **Read-back**: re-fetch the product and verify each changed field matches expectation
2. **Compare**: field-by-field comparison of intended vs actual
3. **If mismatch**: retry the failed field once, then report if still wrong
4. **Verify side effects**:
   - Did collection assignments persist?
   - Did variant prices apply correctly?
   - Are images in the right order?

### Receipt (logged to audit)

Every product update produces a receipt:

```json
{
  "action": "product_update",
  "product_id": "8234567890123",
  "product_title": "Red Heart Fleece Hoodie Set",
  "timestamp": "2026-03-31T14:30:00Z",
  "changes": [
    { "field": "title", "before": "Red Heart Fleece Set", "after": "Red Heart Fleece Hoodie Set" },
    {
      "field": "tags",
      "before": ["red", "fleece"],
      "after": ["red", "fleece", "hoodie", "winter"]
    },
    { "field": "price", "before": 34.99, "after": 31.99, "reason": "Seasonal sale" }
  ],
  "verified": true,
  "status": "success"
}
```

---

## Create Product Listing

Follow `procedures/product-listing.md` Phase 3 (Create Draft):

1. Navigate to `admin.shopify.com/products/new`
2. Fill: Title (SEO-friendly, <=60 chars), Description, Product type
3. Set category metafields: Color, Size, Fabric, Age group, Target gender
4. Set product metafields: Pattern, Style, Type, SubCategory
5. Add tags: color + collection + relationship + brand + product type
6. Assign collections: "Mommy and Me" (always) + seasonal + category
7. Upload images (flag face swap needs -- Chinese faces -> swap needed)
8. Build size chart per `procedures/size-chart-guide.md`: extract 1688 measurements, convert sizes, build HTML table with inline CSS, include "sizes run small" warning + "How to Measure" guide, show both inches & CM
9. Set variants per `procedures/size-chart-guide.md` S4: US-friendly labels like `3T (100cm)` for kids, `M (US S)` for adults. For sets: Option 1 = Mom Size, Option 2 = Child Size. Every variant needs SKU (`DLM-[code]-[size]`), price, weight.
10. **Save as DRAFT** -- NEVER publish active without Francisco's approval

### Quality Gates (all must pass before save)

- [ ] Price >= Total Cost x 2 (50% margin)
- [ ] All required metafields filled
- [ ] Images uploaded (face swap flagged if needed)
- [ ] Size chart from actual 1688 data (HTML table, not image)
- [ ] Both inches and CM in size chart
- [ ] "Sizes run small" warning present
- [ ] Tags and collections assigned
- [ ] All variants have SKU, price, weight
- [ ] Inventory tracking ON for all variants
- [ ] Status = DRAFT

### Post-Creation Verification

- Re-open the draft and verify all fields saved correctly
- Check variant count matches expectation
- Confirm images are in correct order
- Log creation to audit with draft URL

---

## Inventory Monitoring

### Configuration

| Setting             | Default                | Configurable via |
| ------------------- | ---------------------- | ---------------- |
| Low stock threshold | 5 units                | User directive   |
| OOS alert channel   | Telegram (8438693397)  | moltbot config   |
| Check frequency     | On-demand or scheduled | Scheduled task   |

### Monitoring Workflow

1. **Fetch inventory levels** from Shopify admin (Products page, filter by inventory)
2. **Identify low-stock items**: any variant with inventory <= threshold
3. **Identify out-of-stock items**: any variant with inventory = 0
4. **Cross-reference BuckyDrop**: is the supplier still stocking this item?

### Alert Protocol

**Out-of-Stock (immediate alert)**:

```
via Telegram:
"OOS Alert: [Product Title] -- [Variant] is out of stock.
BuckyDrop status: [available/unavailable/unknown]
Last sold: [date if known]
Action needed: [restock via BuckyDrop / mark unavailable / remove listing]"
```

**Low Stock (batched alert)**:

```
via Telegram:
"Low Stock Report ([N] items):
- [Product] / [Variant]: [X] remaining
- [Product] / [Variant]: [X] remaining
Restock recommendations attached."
```

### Restock Recommendation

When sales velocity data is available from Shopify:

```
Product: [Title]
Current stock: [X] units
Avg daily sales: [Y] units/day [VERIFIED from Shopify orders API]
Days until OOS: [X/Y] days
Recommendation: Reorder [Z] units (30-day supply)
Lead time (BuckyDrop): ~7-14 days
```

Tag sales velocity data:

- `[VERIFIED]` -- calculated from actual Shopify order data via API
- `[ESTIMATED]` -- calculated from limited data or extrapolated
- `[UNVERIFIED]` -- from memory or conversation, not confirmed against API

---

## Order Management

1. Check `admin.shopify.com/orders`
2. Report: new orders, fulfillment status, returns
3. Flag anything needing Francisco's attention:
   - Returns/refunds > $50
   - Orders unfulfilled > 5 days
   - Customer complaints
4. Cross-reference BuckyDrop fulfillment status

---

## SEO Optimization

1. Audit product titles: <=60 chars, primary keyword included, brand-appropriate
2. Audit descriptions: unique content, keywords natural, benefits-focused
3. Audit meta titles and descriptions
4. Check image alt tags: descriptive, keyword-rich
5. Research keywords via `web_search` (minimum 3 sources)
6. Update titles/descriptions for better ranking
7. Log all SEO changes to audit with before/after values

---

## Evidence Standards

### Audit Log

**File**: `workspace/memory/shopify-audit.jsonl`

Every product mutation (create, update, delete, price change, status change) gets a JSONL entry:

```json
{"timestamp": "2026-03-31T14:30:00Z", "action": "price_change", "product_id": "123", "product_title": "...", "changes": {...}, "reason": "...", "tier": 1, "verified": true, "operator": "fsuelsbot"}
```

### Required fields per audit entry

| Field         | Required          | Description                                                 |
| ------------- | ----------------- | ----------------------------------------------------------- |
| timestamp     | Yes               | ISO 8601 UTC                                                |
| action        | Yes               | create / update / delete / price_change / publish / archive |
| product_id    | Yes               | Shopify product ID                                          |
| product_title | Yes               | Human-readable name                                         |
| changes       | Yes               | Object with before/after for each changed field             |
| reason        | For price changes | Why the change was made                                     |
| tier          | Yes               | Permission tier used (0, 1, or 2)                           |
| verified      | Yes               | Was read-back verification performed?                       |
| operator      | Yes               | "fsuelsbot" or "francisco" (manual)                         |

### Data Tagging

All data claims in reports and alerts must be tagged:

- `[VERIFIED]` -- data retrieved directly from Shopify API or admin in this session
- `[ESTIMATED]` -- calculated/derived from verified data with stated assumptions
- `[UNVERIFIED]` -- from memory, conversation, or external sources not confirmed against Shopify

### Price Change Log

In addition to the main audit log, price changes are also tracked with full context:

```json
{
  "timestamp": "...",
  "product_id": "...",
  "old_price": 34.99,
  "new_price": 31.99,
  "change_pct": -8.57,
  "reason": "...",
  "margin_after": 45.2,
  "approved_by": "tier1_auto",
  "rollback_price": 34.99
}
```

The `rollback_price` field enables instant recovery if a price change needs to be undone.

---

## Success Criteria

- [ ] All required inputs were available or resolved via search
- [ ] Pre-flight checks passed (product exists, permissions clear)
- [ ] Mutation executed successfully
- [ ] Post-flight read-back verification passed
- [ ] Audit log entry written and confirmed
- [ ] Price changes verified within safety bounds
- [ ] Alerts sent for inventory issues (if applicable)
- [ ] All data claims tagged with evidence level

## Error Handling Summary

| Failure                   | Detection                   | Response                                      |
| ------------------------- | --------------------------- | --------------------------------------------- |
| Shopify API 429           | HTTP status code            | Exponential backoff, 3 retries, then queue    |
| Product not found (404)   | HTTP status or empty search | Verify ID, search by title, report if missing |
| Conflict (409)            | HTTP status                 | Re-fetch, merge, retry once                   |
| Auth failure (401/403)    | HTTP status                 | Check session, report to Francisco            |
| Network timeout           | No response within 30s      | Retry once, then queue for later              |
| Price exceeds +/-10%      | Pre-change calculation      | Block, escalate to Tier 2                     |
| Price below margin floor  | Pre-change calculation      | Block, report margin violation                |
| Read-back mismatch        | Post-flight comparison      | Retry field, rollback if persistent           |
| Browser element not found | Selector fails              | Fall back through TOOLS.md chain              |
| Audit log write fails     | File write error            | Retry, then log to /tmp as fallback           |

## Common Mistakes

**DO NOT:**

- Publish a product as Active (always DRAFT, Francisco activates)
- Change prices > 10% without Francisco's approval
- Skip the read-back verification after any mutation
- Accept a price below Total Cost x 2 without flagging
- Skip competitor research when setting prices
- Leave Chinese size labels in variants (convert to US-friendly)
- Paste 1688 size chart images instead of building HTML tables
- Start a Shopify draft before BuckyDrop costs are extracted
- Report sales data as [VERIFIED] if it was calculated or estimated
- Forget to log mutations to the audit file

**ALWAYS:**

- Run read-back verification after every write operation
- Log every mutation to `workspace/memory/shopify-audit.jsonl`
- Include a reason for every price change
- Check margin meets 50% floor before applying any price
- Use US-friendly size labels with CM in parentheses
- Include "sizes run small" warning in every size chart
- Tag data claims with evidence level ([VERIFIED] / [ESTIMATED] / [UNVERIFIED])
- Follow the browser fallback chain from TOOLS.md on automation failures
