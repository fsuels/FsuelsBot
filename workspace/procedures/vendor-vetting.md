# 1688 Vendor Vetting Procedure

_Updated: 2026-02-21_

**Reference for the 5-point vendor check used in product scouting.**
For scoring table and pipeline context, see `procedures/product-listing.md`.

---

## Quick Scoring (Reference)

| Factor    | 0 pts       | 1 pt     | 2 pts  |
| --------- | ----------- | -------- | ------ |
| Rating    | <4.0        | 4.0-4.4  | 4.5+   |
| Sales     | None        | Some     | Active |
| Store Age | <1yr        | 1-3yr    | 3+yr   |
| Response  | <80%        | 80-90%   | 90%+   |
| Stock     | Low/unclear | Moderate | Plenty |

- **8-10:** Excellent - proceed
- **6-7:** Acceptable - proceed with caution
- **4-5:** Risky - flag to Francisco
- **0-3:** REJECT

---

## How to Check Each Factor

### 1. Store Rating (店铺评分)

**Where:** Star rating near store name, labeled "店铺评分" or similar.

| Rating    | Action                        |
| --------- | ----------------------------- |
| 4.5+      | Prioritize                    |
| 4.0-4.4   | Check other factors carefully |
| Below 4.0 | REJECT                        |

---

### 2. Transaction Volume (成交量)

**Where:** Product listing shows "成交 XXX 笔" (transactions).

**Good signs:**

- Active sales count on listing
- "Hot" or "popular" indicators
- Recent review dates (within 30 days)

**Red flags:**

- Zero sales on listing
- No reviews in 3+ months
- Sales count vs review count mismatch (fake?)

---

### 3. Store Age (店铺年限)

**Where:** Store profile page, look for establishment date or "开店时间."

| Age       | Trust                    |
| --------- | ------------------------ |
| 3+ years  | High                     |
| 1-3 years | Moderate                 |
| < 1 year  | Avoid unless exceptional |

New stores risk: disappearing, inconsistent quality, poor dispute handling.

---

### 4. Response Rate (响应率)

**Where:** Store profile, percentage and response time shown.

- Aim for 90%+ response rate
- Check for "Gold supplier" or verified badges
- Fast response = active management

---

### 5. Stock Availability (库存)

**CRITICAL:** 1688 often shows products that are no longer available.

**Verify before committing:**

- Stock indicator shows inventory (not "售罄" / sold out)
- Multiple variants in stock (not just 1 size)
- No "last item" warnings
- Price hasn't changed dramatically (clearance = discontinuing)

**If uncertain:** Import to BuckyDrop — it will fail if unavailable.

---

## Fake Data Detection

Before trusting vendor indicators, verify:

- **Reviews are real** — check for copy-paste patterns (same text repeated = fake)
- **Sales/review ratio** — 1000 sales + 5 reviews = suspicious
- **Badges verified** — understand what "诚信通" actually requires
- **2+ indicators agree** — don't trust rating alone
- **Photos are actual products** — not stock images or stolen from others

### Fake Data Red Flags:

- All reviews have similar wording
- Review dates clustered unnaturally
- Sales jumped suddenly
- Store has unrelated product categories

---

## Bonus Indicators

**Positive:**

- 实力商家 (Strength Merchant) badge
- 诚信通 (Trustpass) member
- 工厂直销 (Factory direct)
- Multiple product photos with size charts
- Real model photos (not just flat lay)

**Negative:**

- Prices WAY below competitors (too good = bait)
- Stock photos instead of real product photos
- Store sells many unrelated categories
- Reviews mention quality issues or shipping delays

---

## Instant Reject (Any One = Skip)

- Rating below 4.0
- Store < 6 months old with few sales
- No transactions in 3+ months
- Product sold out or discontinued
- Prices 50%+ below all competitors
- Only stock photos
- Complaints about fake/counterfeit goods

---

## Vendor Tracking

Save good vendors for future sourcing:

**File:** `knowledge/entities/1688-vendors.md`

```
## [Store Name]
- URL: [store link]
- Rating: [X] stars
- Specialty: [product types]
- Last used: [date]
- Products sourced: [list]
- Notes: [quality, speed, issues]
```

---

## Example Output

Good:

> "Vendor: 杭州美美童装店 — 4.7 stars, 5yr, 2,847 sales, 94% response, stock plenty. Score: 10/10. PASS."

Reject:

> "Vendor: 新开服装批发 — 3.8 stars, 4mo, 12 sales. Score: 2/10. REJECT."
