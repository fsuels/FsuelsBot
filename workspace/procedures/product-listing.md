---
version: "1.0"
created: "2026-01-29"
updated: "2026-01-29"
verified: "2026-01-29"
confidence: "high"
type: "procedure"
---

# 📦 Complete Product Listing Procedure (MANDATORY)

**Read this COMPLETELY before ANY product listing or sourcing task.**

---

## Verification Gate

**Before starting ANY listing work, state:**

> "Product procedure verified. Checked existing inventory: [X active, Y drafts]. Browser tabs checked: [N] open. Ready for [discovery/import/draft] phase."

If you cannot state this, STOP and do the pre-flight checklist.

---

## Phase 0: Know What We Have (ALWAYS FIRST)

Before sourcing ANY new products:

1. **Check Shopify inventory**
   - Active products in the relevant collection
   - Draft products in progress
   - Don't duplicate what we already have!

2. **Check current drafts list**
   - What's already being worked on?
   - What's waiting for Francisco's review?

**State:** "Inventory check: [X] active products, [Y] drafts in queue. Looking for: [product type]."

---

## Phase 1: Product Discovery on 1688

### 1.1 Vendor Quality Checks (CRITICAL)

**Before selecting ANY product, verify the vendor:**

- [ ] **Store rating** — 4.5+ stars preferred, never below 4.0
- [ ] **Transaction volume** — Active sales (shows recent orders)
- [ ] **Store age** — Established sellers (1+ years preferred)
- [ ] **Response rate** — High response = reliable communication
- [ ] **Product availability** — Check stock indicators, avoid "last item" or low stock

**Red flags (AVOID these vendors):**
- ❌ No recent sales/reviews
- ❌ Store opened recently with no history
- ❌ Poor ratings or many complaints
- ❌ Listings that look too good to be true
- ❌ Products showing "sold out" or "discontinued"

### 1.2 Product Selection Criteria

**We sell: Mommy and me / family matching outfits**

Good products have:
- ✅ **Multiple sizes** — Adult AND child sizes in same listing
- ✅ **Matching designs** — Same fabric/pattern for both
- ✅ **Good photos** — Clear, professional images
- ✅ **Hot market appeal** — Seasonal (Valentine, Easter, etc.) or evergreen (solid patterns)
- ✅ **Reasonable base cost** — Allows 50%+ margin at competitive price

**Avoid:**
- ❌ Adult-only products (not "matching")
- ❌ Poor quality photos
- ❌ Products from unreliable vendors
- ❌ Items already in our catalog (check Phase 0!)

### 1.3 Freshness Check

- Sort by "newest" or "recent sales" when searching
- Check if listing was recently updated
- Verify product photos look current (not dated styles)

**State:** "Product discovery: Vendor [name] has [rating], [transaction count] sales. Product fits matching criteria. Fresh listing."

---

## Phase 2: BuckyDrop Import

1. Open BuckyDrop (use existing tab if open)
2. Import product using 1688 URL
3. Configure:
   - Shipping route: **YunExpress** (default)
   - Shipping destination: **USA** (even for UK/Canada/Australia orders)
   - Variants: all sizes needed

4. **Get the FULL cost breakdown:**
   - Product cost
   - Domestic shipping (China)
   - International shipping (to USA)
   - BuckyDrop fees
   - **TOTAL COST = sum of all above**

**State:** "BuckyDrop import complete. Total cost: $[X] (product $[A] + domestic $[B] + intl $[C] + fees $[D])."

---

## Phase 3: Pricing

### The Formula (NON-NEGOTIABLE)

```
MINIMUM PRICE = TOTAL COST × 2

This ensures AT LEAST 50% profit margin.

Examples:
- $10 total cost → $20 minimum price
- $15 total cost → $30 minimum price  
- $24 total cost → $48 minimum price
```

### Competitor Check

Before finalizing price:
1. Search Amazon, Etsy, Google Shopping for similar products
2. Note competitor price range
3. If competitors are cheaper than our 2× cost → FLAG to Francisco
4. If room exists → price between 2× cost and competitor average

**State:** "Pricing: Cost $[X] × 2 = $[Y] minimum. Competitors at $[A]-$[B]. Final price: $[Z] ([M]% margin)."

---

## Phase 4: Shopify Draft Creation

### 4.1 Basic Info
- **Title:** Clear, SEO-friendly (e.g., "Valentine Heart Mommy and Me Matching Pajamas")
- **Description:** Benefits, materials, sizing info
- **Tags:** Collection tags (Valentine's Day, Summer, etc.)
- **Product type:** Set appropriately

### 4.2 Images
- Upload all product images
- **FACE CHECK:** If Chinese faces visible → need face swap
- Order: Main image first, then angles, then size chart

### 4.3 Face Swapping (if needed)

**When:** Product photos show Chinese models

**Process:**
1. Download product images
2. Go to: https://aifaceswap.io/#face-swap-playground
3. Use faces from: `C:\Users\Fsuels\Downloads\faces`
4. Swap to American-looking faces
5. Save new images
6. Upload to Shopify

**State:** "Face swap: [X] images processed with American faces."

### 4.4 Size Chart

1. Check if product has sizing information
2. Apply our size chart conversion script
3. Ensure the dynamic size selector works properly
4. Test: When customer selects size, correct info displays

**State:** "Size chart: Verified working with conversion script."

### 4.5 Variants & Pricing

- Set up all size variants (Adult S/M/L/XL, Child sizes)
- Apply calculated price to all variants
- Verify no variant is priced below minimum

### 4.6 Save as DRAFT

- **NEVER publish active** — Francisco reviews all drafts first
- Save as DRAFT
- Note draft number for tracking

**State:** "Draft #[N] created: [Product name]. Price: $[X]. Awaiting Francisco's review."

---

## Phase 5: Cleanup & Tracking

1. **Browser tabs:** Close any unneeded, keep ≤ 4
2. **Update tracking:**
   - state.json → Update progress count
   - memory file → Log what was completed
3. **Update draft list** for Phase 0 of next product

---

## Quick Reference Checklists

### Pre-Discovery Checklist
- [ ] Read this procedure completely
- [ ] Check existing active products
- [ ] Check existing drafts
- [ ] Browser tabs checked (ONE per domain)

### Vendor Verification Checklist
- [ ] Rating 4.5+
- [ ] Recent transaction volume
- [ ] Store established (1+ years)
- [ ] Product in stock

### Draft Completion Checklist
- [ ] Title optimized
- [ ] Description complete
- [ ] All images uploaded
- [ ] Face swap done (if needed)
- [ ] Size chart working
- [ ] Price ≥ 2× cost
- [ ] Tagged for collections
- [ ] Saved as DRAFT (not active)
- [ ] Tracking updated

---

## Common Mistakes to Avoid

❌ Sourcing without checking what we already have
❌ Picking products from unreliable vendors
❌ Skipping BuckyDrop cost calculation
❌ Pricing below 2× cost
❌ Publishing active instead of draft
❌ Leaving Chinese faces in photos
❌ Forgetting to update tracking

✅ Always check inventory first
✅ Always verify vendor reputation
✅ Always get FULL cost from BuckyDrop
✅ Always 50% minimum margin
✅ Always save as DRAFT
✅ Always swap faces if needed
✅ Always update tracking

---

## Exit State

After completing a product listing session:

```
Completed: [N] drafts created
Products: [list names]
Prices: [list prices with margins]
Face swaps: [X] images processed
Browser: [Y] tabs remaining
Status: Drafts ready for Francisco's review
```
