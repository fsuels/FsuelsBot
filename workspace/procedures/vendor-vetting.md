---
version: "1.1"
created: "2026-01-29"
updated: "2026-01-31"
verified: "2026-01-31"
confidence: "high"
type: "procedure"
---

# 🏪 1688 Vendor Vetting Procedure

## 🧭 EPISTEMIC DISCIPLINE (READ FIRST)

```
EVERY response I give
EVERY analysis I make
EVERY recommendation I offer
EVERY claim I accept
EVERY action I take
        ↓
   SOUND LOGIC
 VERIFIED EVIDENCE
   NO FALLACIES
```

### Before completing this procedure, verify:
- [ ] Logic is sound (no gaps in reasoning)
- [ ] Evidence is verified (not assumed)
- [ ] Fallacies checked (see Evidence Verification below)

---

**Use this when evaluating ANY vendor on 1688.com before sourcing products.**

---

## Verification Gate

**Before selecting ANY product from a vendor, state:**

> "Vendor check: [Store name] — Rating [X], [Y] years active, [Z] recent transactions. Passes: [list criteria]. Proceed: yes/no."

---

## The 5-Point Vendor Check

### 1. Store Rating (权重/评分)

| Rating | Action |
|--------|--------|
| 4.8+ ⭐ | Excellent — prioritize this vendor |
| 4.5-4.7 ⭐ | Good — acceptable |
| 4.0-4.4 ⭐ | Caution — check other factors carefully |
| Below 4.0 ⭐ | REJECT — do not source from this vendor |

**Where to find:** Look for star rating near store name, often shows as "店铺评分" or similar.

---

### 2. Transaction Volume (成交量)

**Recent sales indicate:**
- Product is actually available
- Vendor is actively fulfilling orders
- Demand exists for this product

**Check for:**
- [ ] Sales count on product listing (成交 XXX 笔)
- [ ] "Hot" or "popular" indicators
- [ ] Recent review dates (within last 30 days)

**Red flags:**
- ❌ Zero sales on listing
- ❌ No reviews in past 3+ months
- ❌ Sales count doesn't match review count (fake?)

---

### 3. Store Age & History (店铺年限)

| Age | Trust Level |
|-----|-------------|
| 3+ years | High trust — established business |
| 1-3 years | Moderate — verify other factors |
| < 1 year | Low trust — avoid unless exceptional ratings |

**Where to find:** Store profile page, look for establishment date or "开店时间."

**Why it matters:** New stores may:
- Disappear suddenly
- Have inconsistent quality
- Not handle disputes well
- Be fronts for scams

---

### 4. Response Rate & Speed (响应率)

Good vendors respond quickly to inquiries. This indicates:
- Active management
- Good customer service
- Reliable communication for issues

**Check for:**
- [ ] Response rate percentage (aim for 90%+)
- [ ] Average response time
- [ ] "Gold supplier" or verified badges

---

### 5. Product Availability (库存)

**CRITICAL:** 1688 often shows products that are no longer available.

**Before committing, verify:**
- [ ] Stock indicator shows inventory (not "售罄" / sold out)
- [ ] Multiple variants in stock (not just 1 size)
- [ ] Listing was recently updated
- [ ] No "last item" warnings
- [ ] Price hasn't changed dramatically (clearance = discontinuing)

**How to verify availability:**
1. Check stock numbers on listing
2. Look at recent purchase dates in reviews
3. If uncertain → use BuckyDrop to attempt import (will fail if unavailable)

---

## Bonus Indicators (Nice to Have)

### Verified/Certified Badges
- 实力商家 (Strength Merchant)
- 诚信通 (Trustpass member)
- 工厂直销 (Factory direct)

### Product Quality Signals
- Multiple product photos (not just 1-2)
- Size charts included
- Material specifications listed
- Real model photos (not just flat lay)

### Negative Signals to Watch
- ⚠️ Prices WAY below competitors (too good = fake/bait)
- ⚠️ Stock photos instead of real product photos
- ⚠️ Copied descriptions from other listings
- ⚠️ Store has many unrelated product categories (jack of all trades)
- ⚠️ Reviews mention quality issues or shipping delays

---

---

## 🔍 Evidence Verification (MANDATORY — Fallacy Prevention)

Before trusting ANY vendor indicator, verify:
- [ ] **Reviews are REAL** — check for copy-paste patterns (fake = same text repeated)
- [ ] **Sales/review ratio is reasonable** — 1000 sales + 5 reviews = suspicious
- [ ] **Badges verified** — understand what "诚信通" actually requires
- [ ] **At least 2 independent indicators agree** — rating + sales + age
- [ ] **Not Bandwagon fallacy** — not selecting because "others use this vendor"
- [ ] **Not Appeal to Authority** — "Factory direct" label verified, not just claimed
- [ ] **Photos are ACTUAL products** — not stock images or stolen from others

### Red Flags for Fake Data:
- All reviews have similar wording
- Review dates clustered unnaturally
- Sales jumped suddenly (bought reviews)
- Store has unrelated product categories

---

## Quick Scoring System

Rate each factor 0-2 points:

| Factor | 0 pts | 1 pt | 2 pts |
|--------|-------|------|-------|
| Rating | <4.0 | 4.0-4.4 | 4.5+ |
| Sales | None | Some | Active |
| Store Age | <1yr | 1-3yr | 3+yr |
| Response | <80% | 80-90% | 90%+ |
| Stock | Low/unclear | Moderate | Plenty |

**Scoring:**
- **8-10 points:** ✅ Excellent vendor — proceed confidently
- **6-7 points:** ⚠️ Acceptable — proceed with caution
- **4-5 points:** ❓ Risky — only if no better option, flag to Francisco
- **0-3 points:** ❌ REJECT — do not source

---

## Vendor Tracking

When we find good vendors, save them for future sourcing:

**File:** `knowledge/entities/1688-vendors.md`

Format:
```
## [Store Name]
- **URL:** [store link]
- **Rating:** [X] stars
- **Specialty:** [product types]
- **Notes:** [quality, speed, issues]
- **Last used:** [date]
- **Products sourced:** [list]
```

Building a list of trusted vendors saves time on future sourcing.

---

## Red Flags Summary (INSTANT REJECT)

If you see ANY of these, do NOT source from this vendor:

❌ Rating below 4.0
❌ Store less than 6 months old with few sales
❌ No recent transactions (3+ months)
❌ Product marked sold out or discontinued
❌ Prices 50%+ below all competitors
❌ Only stock photos, no real product images
❌ Multiple negative reviews about non-delivery
❌ Store has complaints about fake/counterfeit goods

---

## Process Flow

```
Find interesting product on 1688
         ↓
    Run 5-Point Check
         ↓
    Score the vendor
         ↓
   Score 6+ ? ──NO──→ Find different vendor
         ↓ YES
   Verify stock available
         ↓
   Proceed to BuckyDrop import
         ↓
   If good vendor, add to trusted list
```

---

## Example Vendor Check

> "Vendor check: 杭州美美童装店 — Rating 4.7⭐, 5 years active, 2,847 recent transactions. Passes: rating (2), sales (2), age (2), response 94% (2), stock plenty (2). Score: 10/10. Proceed: YES."

Or rejection:

> "Vendor check: 新开服装批发 — Rating 3.8⭐, 4 months active, 12 transactions. Fails: rating (0), age (0), low sales (0). Score: 2/10. Proceed: NO — finding alternative vendor."
