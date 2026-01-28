# Microsoft Ads Deep Dive — Dress Like Mommy

**Report Date:** January 27, 2026  
**Account:** 477439 | Customer: 770182 | User: X0875435 (Francisco Suels)  
**Login:** suelsferro@hotmail.com  
**Data Range:** Entire time (1/26/2023 – 1/26/2026)

---

## 1. Account Status

| Field | Value |
|-------|-------|
| Account ID | 477439 |
| Account Status | **Active** (but all campaigns PAUSED) |
| Restrictions | None visible |
| Banner Warning | "None of your ads are running, because you have paused your campaigns." |
| MS Recommendation | "Fix your UET tag — Make sure you don't miss any conversions" |

The account itself is in good standing — no suspensions, no billing issues, no policy violations flagged. All 11 campaigns are **paused**, so zero ad spend is occurring.

---

## 2. Campaign History

**11 total campaigns — ALL PAUSED**

### Active Campaigns (Had Historical Data) — 5 campaigns

These ran and generated real traffic/revenue:

| # | Campaign | Type | Budget | Bid Strategy |
|---|----------|------|--------|-------------|
| 1 | USA - Cold Traffic | Search | $10/day | Enhanced CPC |
| 2 | Australia - Cold Traffic New | Search | $5/day | Enhanced CPC |
| 3 | United Kingdom - Cold Traffic New | Search | $5/day | Enhanced CPC |
| 4 | Canada - Cold Traffic New | Search | $5/day | Enhanced CPC |
| 5 | Rest Europe & World - Cold Traffic New | Search | $5/day | Enhanced CPC |

### Dormant/Never-Ran Campaigns — 6 campaigns

These show $0 across all metrics (never generated impressions):

| # | Campaign | Type | Budget | Issue |
|---|----------|------|--------|-------|
| 6 | USA Shopping | Shopping | $15/day | ❌ ERROR: "Product offers not found" |
| 7 | Europe - Cold Traffic | Search | $15/day | Never ran |
| 8 | India - Cold Traffic | Search | $15/day | Never ran |
| 9 | Australia - Cold Traffic | Search | $15/day | Never ran |
| 10 | UK - Cold Traffic | Search | $15/day | Never ran |
| 11 | Canada - Cold Traffic | Search | $15/day | Never ran |

**Pattern:** Two generations of campaigns exist. The original set (UK, Australia, Canada, Europe, India) had $15/day budgets but never ran. The "New" versions (with $5/day budgets) replaced them and actually ran successfully.

---

## 3. Spend History

| Period | Spend |
|--------|-------|
| **Last 7 days** | $0.00 |
| **Last 30 days** | $0.00 |
| **Last 90 days** | $0.00 |
| **All Time** | **$5,117.92** |

### Spend Breakdown by Network
- Search ads: $5,051.45 (98.7%)
- Audience ads: $66.47 (1.3%)
- Performance Max: $0
- Deleted items: $0

**Total combined daily budget (if all enabled): $120/day**

---

## 4. Performance — All Time

### Per-Campaign Breakdown

| Campaign | Spend | Revenue | Conv | CPA | Conv Rate | Clicks | CPC | CTR | Impr | ROAS |
|----------|-------|---------|------|-----|-----------|--------|-----|-----|------|------|
| **USA - Cold Traffic** | $4,016.94 | $8,732.04 | 553 | $7.26 | 3.17% | 17,423 | $0.23 | 6.46% | 269,737 | **217%** |
| **Australia - Cold Traffic New** | $113.11 | $1,015.00 | 59 | $1.92 | 11.94% | 494 | $0.23 | 4.12% | 11,982 | **897%** |
| **UK - Cold Traffic New** | $598.04 | $691.00 | 52 | $11.50 | 2.10% | 2,474 | $0.24 | 9.83% | 25,164 | **116%** |
| **Canada - Cold Traffic New** | $210.75 | $978.00 | 23 | $9.16 | 2.45% | 937 | $0.22 | 2.22% | 42,149 | **464%** |
| **Rest Europe & World** | $179.08 | $72.90 | 22 | $8.14 | 2.96% | 744 | $0.24 | 3.65% | 20,411 | **41%** |

### Overall Totals

| Metric | Value |
|--------|-------|
| **Total Spend** | $5,117.92 |
| **Total Revenue** | $11,488.94 |
| **Total Conversions** | 709 |
| **Overall CPA** | $7.22 |
| **Overall Conv. Rate** | 3.21% |
| **Total Clicks** | 22,072 |
| **Avg. CPC** | $0.23 |
| **Overall CTR** | 5.97% |
| **Total Impressions** | 369,443 |
| **Overall ROAS** | **224.48%** (2.24x) |

### Impression Share Metrics (All Time)
| Metric | Value |
|--------|-------|
| Impression share | 16.21% |
| IS lost to rank | 83.75% |
| IS lost to budget | 0.04% |
| Click share | 10.82% |
| Exact match impr. share | 35.96% |
| Top impr. share | 16.55% |
| Top IS lost to rank | 83.44% |
| Abs. top impr. share | 10.35% |
| Avg. CPM | $13.85 |

### Key Insight: The account was **budget-efficient but rank-starved**
- Only 0.04% of impressions lost to budget → budget was not the issue
- **83.75% lost to rank** → Ad rank / quality score was the major limiter
- Only captured 16.21% of available impressions

---

## 5. UET Tag Health

**4 UET tags on the account:**

| Tag Name | Tag ID | Status | Description |
|----------|--------|--------|-------------|
| DELETED 1 | 4003544 | ❌ Tag inactive | Deleted tag |
| DELETED 2 | 4003545 | ❌ Tag inactive | Deleted tag |
| dresslikemommy.com | 36000629 | ❌ Tag inactive | "dresslikemommy.com sales conversion tracking" |
| **ShopifyImport** | **36005151** | ✅ **Tag ACTIVE** | "Auto-generated tag for ShopifyImport" |

**Tag ID 36005151 (ShopifyImport) IS firing and active!** This is the auto-generated tag from the Shopify import. However, Microsoft is still recommending "Fix your UET tag" — likely because the dresslikemommy.com tag (36000629) is inactive, and some conversion goals may reference it.

---

## 6. Conversion Goals

**5 conversion goals configured:**

| Goal Name | Type | Status/Tracking | Included in Conversions | Scope | Count |
|-----------|------|-----------------|------------------------|-------|-------|
| Smart goal [X0875435] | Smart | Active (green) | — | On account: X0875435 | — |
| ShopifyCheckoutComplete... | Destination URL | Active (green) | — | On account: X0875435 | Unique |
| ShopifyCheckoutCompleteEventTracking | Event | ⚠️ No recent conversions | Yes | On account: X0875435 | Unique |
| ShopifyAddToCart | Event | ⚠️ No recent conversions | **No** | Across all accounts | All |
| Purchases | Destination URL | ❌ Tag inactive | Yes | On account: X0875435 | All |

### Issues:
- **ShopifyCheckoutCompleteEventTracking**: Marked "Yes" for inclusion but showing "No recent conversions"
- **ShopifyAddToCart**: Not included in conversion counts (set to "No")
- **Purchases**: Tag is inactive — this goal is broken and may have been the primary revenue tracking goal
- Since all campaigns are paused, "no recent conversions" is expected

---

## 7. Audiences

The Audiences page shows the account has access to all audience types:
- Remarketing lists
- Custom audiences
- Dynamic remarketing
- In-market audiences
- Similar audiences
- Combined lists
- Customer match lists
- Impression-based remarketing

**No custom remarketing audiences appear to have been created.** The account relied purely on keyword targeting for search campaigns — no audience layering or remarketing was used.

---

## 8. Shopping Campaigns

### Campaign Status
- **1 Shopping campaign exists:** "USA Shopping" — **PAUSED**, $0 spent all time
- **Error:** "Product offers not found" — the campaign never served because no products were available

### Merchant Center Stores
| Store Name | Status |
|------------|--------|
| dresslikemommy shopify | ✅ Approved |
| Dresslikemommy.com | ✅ Approved |

Both stores are approved, but the Shopping campaign couldn't find products. This suggests the **product feed is empty, not linked properly, or products are disapproved** in the Microsoft Merchant Center.

---

## 9. Recommendations for Francisco

### 🔴 Immediate Actions (If Restarting)

1. **Fix the UET Tag Situation**
   - The dresslikemommy.com tag (36000629) is inactive. If "Purchases" goal used this tag, that's why it shows "Tag inactive"
   - Ensure tag 36005151 (ShopifyImport, active) is properly connected to all conversion goals
   - Verify the "Purchases" conversion goal is pointing to the correct active UET tag

2. **Fix the Shopping Campaign**
   - Both Merchant Center stores are approved, but products aren't appearing
   - Check if the product feed is actually populated with products
   - Verify the Shopping campaign is linked to the correct store
   - Shopping could be a huge revenue driver given the ROAS on search campaigns

3. **Clean Up Dead Campaigns**
   - Delete the 6 campaigns that never ran (original Europe, India, Australia, UK, Canada, and USA Shopping if unfixable)
   - Reduce clutter and focus on what works

### 🟡 Strategic Improvements

4. **The USA Campaign Was a Cash Machine**
   - $4,017 spent → $8,732 revenue → 217% ROAS
   - 553 conversions at $7.26 CPA
   - This campaign alone was responsible for 78% of total spend and 76% of revenue
   - **Un-pause this campaign first** if restarting

5. **Australia Was the Hidden Gem**
   - $113 spent → $1,015 revenue → **897% ROAS** (best performing!)
   - $1.92 CPA with 11.94% conversion rate
   - Only ran at $5/day — **scale this up significantly**

6. **Canada Also Excellent**
   - $211 spent → $978 revenue → 464% ROAS
   - Low budget, high returns — increase budget

7. **Address the Rank Problem**
   - 83.75% of impressions lost to rank (not budget)
   - This means higher bids alone won't help — need better Quality Scores
   - Improve ad relevance, landing page experience, and expected CTR
   - Consider more specific keyword grouping
   - Consider switching from Enhanced CPC to Target CPA or Maximize Conversions

8. **Rest of Europe & World is Underperforming**
   - Only 41% ROAS — losing money
   - Either optimize heavily or reallocate budget to USA/Australia/Canada

9. **Build Remarketing Audiences**
   - Zero audience targeting is being used
   - Create remarketing lists using the active UET tag (36005151)
   - Layer audiences for bid adjustments on search campaigns
   - Create dynamic remarketing for product-level retargeting

10. **Consider Performance Max**
    - No PMax campaigns exist — Microsoft now supports these
    - Could complement search campaigns with multi-format reach

### 🟢 Overall Assessment

| Verdict | Details |
|---------|---------|
| **Account Health** | Good — no issues, just dormant |
| **Historical Performance** | **Strong** — 224% ROAS, $7.22 CPA across $5.1K spend |
| **Biggest Winner** | Australia (897% ROAS) and USA (217% ROAS, most volume) |
| **Biggest Issue** | All campaigns paused — leaving money on the table |
| **Priority** | Un-pause USA + Australia + Canada campaigns, fix UET tag, fix Shopping |

**Bottom Line:** This account made $11,489 in revenue from $5,118 in ad spend — a 2.24x return. The campaigns worked well, especially USA and Australia. The account has been dormant but the infrastructure is sound. The main action needed is to fix the conversion tracking (UET tag), un-pause the top performers, and scale the winners.

---

*Report generated from Microsoft Ads account on January 27, 2026*
