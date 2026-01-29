# 📦 Product Listing Procedure (MANDATORY)

**Read this COMPLETELY before ANY product listing task.**

---

## Pre-Flight Checklist

Before starting any listing work:

1. [ ] Read `procedures/browser.md` (browser rules apply!)
2. [ ] Have the source product URL (usually 1688.com)
3. [ ] Understand the workflow: **1688 → BuckyDrop → Shopify**
4. [ ] Know the pricing formula: **Cost × 2 = Minimum Price**

---

## Verification Gate

**Before starting ANY listing work, state:**

> "Listing check: Source URL is [1688 URL]. Workflow: 1688 → BuckyDrop → Shopify. Browser tabs checked: [N] open."

If you cannot state this, you haven't prepared properly. STOP and do the pre-flight checklist.

---

## The Workflow (FOLLOW IN ORDER)

### Step 1: Source Product (1688)
- Open 1688 product page (or navigate existing 1688 tab)
- Capture: images, title, variants, description
- Note the source URL for records

**State:** "Step 1 complete: Product sourced from 1688."

### Step 2: BuckyDrop Import
- Open BuckyDrop (or navigate existing BuckyDrop tab)
- Import product from 1688 URL
- Configure shipping, variants
- **Get the final cost per unit**

**State:** "Step 2 complete: BuckyDrop import done. Cost: $[X]."

### Step 3: Competitor Research
- Search Amazon, Etsy, Google for similar products
- Note competitor price range (low / high)
- Check if our minimum price is competitive

**State:** "Step 3 complete: Competitors charge $[X]-$[Y]. Our cost is $[Z]."

### Step 4: Calculate Final Price
- Apply formula: Cost × 1.5 = Minimum Price (50% margin)
- Compare to competitor prices
- If room → price closer to competitors for more margin
- If competitors cheaper → FLAG to Francisco
- Round to clean number (.99 or .95)

**State:** "Step 4 complete: Cost $[X] → Price $[Y] ([M]% margin). Competitors at $[A]-$[B]."

### Step 5: Shopify Draft
- Open Shopify admin (or navigate existing Shopify tab)
- Create draft product
- Add: title, description, images, price, variants
- Tag appropriately
- Save as DRAFT (not active)

**State:** "Step 5 complete: Draft created in Shopify."

### Step 6: Cleanup
- Close any tabs no longer needed
- Verify ≤ 4 tabs remain
- Update task status

**State:** "Step 6 complete: Cleanup done."

---

## Pricing Formula (NON-NEGOTIABLE)

```
MINIMUM PRICE = COST × 2

This ensures AT LEAST 50% profit margin.

Examples:
- $10 cost → $20 minimum price
- $15 cost → $30 minimum price  
- $24 cost → $48 minimum price
```

**Never price below 2× cost without explicit approval from Francisco.**

---

## Exit Checklist

Before marking ANY listing task complete:

- [ ] Followed all 6 steps in order
- [ ] Competitor prices checked
- [ ] Price is ≥ 1.5× cost (50% margin)
- [ ] Price is competitive (not way above market)
- [ ] Draft is saved in Shopify
- [ ] No extra browser tabs left open
- [ ] Status updated (state.json / dashboard)

---

## Common Mistakes to Avoid

❌ Skipping BuckyDrop (going direct 1688 → Shopify)
❌ Pricing without calculating cost first
❌ Setting price < 2× cost
❌ Leaving 6+ tabs open
❌ Forgetting to close tabs after each listing

✅ Always: 1688 → BuckyDrop → Shopify
✅ Always: calculate cost FIRST, then price
✅ Always: verify 50% margin minimum
✅ Always: close tabs when done
