# DressLikeMommy.com — Google Ads Conversion Tracking Report

**Date:** 2026-01-26
**Account:** AW-853411529 (ID: 399-097-6848)
**Google Account:** testhqfinds@gmail.com

---

## Executive Summary

All 16 conversion actions are dead (0 recording). Google Ads displays a banner saying "Install a Google tag on your website" — however, **the Google tag (AW-853411529) IS present on www.dresslikemommy.com** (confirmed via source inspection). The issue is a disconnect between old manually-created conversion actions and the new Shopify-managed Google & YouTube pixel, compounded by a **suspended Google Merchant Center account**.

---

## Conversion Tracking Status Overview

From the overview dashboard:
- **Tag inactive:** 5
- **No recent conversions:** 11
- **Recording conversions:** 0
- **Unverified:** 0

---

## All 16 Conversion Actions

### 🟣 Purchase Goal (Account-default, 84/84 campaigns)

| # | Conversion Action | Optimization | Source | All Conv. | Value | Status |
|---|---|---|---|---|---|---|
| 1 | Purchases from google Adwords | **Primary** | Website | 87 | $25,949 | No recent conversions |
| 2 | Google Shopping App Purchase | **Primary** | Website | 0 | $0 | No recent conversions |
| 3 | Purchases from google analytics data | Secondary | Website (GA UA) | 44 | $2,642 | No recent conversions |
| 4 | dresslikemommy.com - GA4 (web) purchase | Secondary | Website (GA4) | 0 | $0 | No recent conversions |

### 🟡 Add to Cart Goal (Account-default, 83/84 campaigns)

| # | Conversion Action | Optimization | Source | All Conv. | Value | Status |
|---|---|---|---|---|---|---|
| 5 | Add To Cart button click from adwords | **Primary** | Website | 1,544 | $49,589 | ⚠️ Needs attention |
| 6 | Google Shopping App Add To Cart | Secondary | Website | 0 | $0 | No recent conversions |

### 🟠 Begin Checkout Goal (0/84 campaigns)

| # | Conversion Action | Optimization | Source | All Conv. | Value | Status |
|---|---|---|---|---|---|---|
| 7 | Begin Checkout from adwords | **Primary** | Website | 123 | $7,589 | ⚠️ Needs attention |
| 8 | Google Shopping App Begin Checkout | Secondary | Website | 0 | $0 | No recent conversions |

### 🔵 Download Goal (Account-default, 83/84 campaigns)

| # | Conversion Action | Optimization | Source | All Conv. | Value | Status |
|---|---|---|---|---|---|---|
| 9 | Android installs (all other apps) | **Primary** | Mobile App (Google Play) | 0 | $0 | No recent conversions |

### 🟢 Page View Goal (0/84 campaigns)

| # | Conversion Action | Optimization | Source | All Conv. | Value | Status |
|---|---|---|---|---|---|---|
| 10 | People that viewed products on website (no purchase) | **Primary** | Website | 27,086 | $0 | No recent conversions |
| 11 | Google Shopping App Page View | Secondary | Website | 0 | $0 | ⚠️ Needs attention |
| 12 | Google Shopping App Search | Secondary | Website | 0 | $0 | No recent conversions |
| 13 | Google Shopping App View Item | Secondary | Website | 0 | $0 | ⚠️ Needs attention |

### ⚪ Other Goal (0/84 campaigns)

| # | Conversion Action | Optimization | Source | All Conv. | Value | Status |
|---|---|---|---|---|---|---|
| 14 | Search button from website that came adwords | **Primary** | Website | 58 | $0 | ⚠️ Needs attention |
| 15 | Payment Info visit from adwords | **Primary** | Website | 34 | $0 | ⚠️ Needs attention |
| 16 | Google Shopping App Add Payment Info | Secondary | Website | 0 | $0 | ⚠️ Needs attention |

---

## Root Cause Analysis

### 1. TWO PARALLEL TRACKING SYSTEMS (conflicting)

There are TWO sets of conversion actions that should NOT coexist as they are:

**Set A — "from adwords" (legacy manual tags):**
- Purchases from google Adwords
- Add To Cart button click from adwords
- Begin Checkout from adwords
- People that viewed products on website (no purchase)
- Search button from website that came adwords
- Payment Info visit from adwords

**Set B — "Google Shopping App" (Shopify-managed):**
- Google Shopping App Purchase
- Google Shopping App Add To Cart
- Google Shopping App Begin Checkout
- Google Shopping App Page View
- Google Shopping App Search
- Google Shopping App View Item
- Google Shopping App Add Payment Info

**Set C — Analytics imports:**
- Purchases from google analytics data (Universal Analytics — DEPRECATED)
- dresslikemommy.com - GA4 (web) purchase

**Set D — Irrelevant:**
- Android installs (all other apps) — NOT applicable to this e-commerce site

### 2. Google Tag IS Present But Old Event Snippets Are Gone

The Google tag `AW-853411529` IS loaded on the website via the Shopify Google & YouTube app pixel (gtag.js confirmed in source HTML). However, the **old manual conversion event snippets** (for the "from adwords" actions) are no longer present — they were likely part of the old Shopify theme before the store migrated to Shopify's web pixel architecture.

**This means:**
- The base Google tag loads ✅
- But no conversion events fire for the old manual actions ❌
- The Shopify app SHOULD fire its own conversion events via the "Google Shopping App" actions, but those aren't recording either

### 3. Google Merchant Center is SUSPENDED

The Google Merchant Center account (ID: 124884876) is **suspended**. This blocks:
- Google Shopping campaigns
- Product feed updates
- May affect Google Shopping App conversion tracking

**Additional Merchant Center issues:**
- 1:1 logo contains errors / doesn't conform to requirements
- 2:1 logo contains errors / doesn't conform to requirements

### 4. Enhanced Conversions Need Attention

The Diagnostics tab shows: "Some enhanced conversion actions need attention" — 8 total enhanced conversion actions configured but with issues.

### 5. Consent Mode Status

Consent mode for web is rated "Excellent" — this is not contributing to the problem.

---

## Shopify Configuration

### Google & YouTube App
- **Connected as:** testhqfinds@gmail.com ✅
- **App pixel status:** Connected ✅
- **Data access:** Optimized
- **Google Ads connection:** Active (Create campaign / Manage campaigns links visible)

### Web Pixels (Customer Events)
| Pixel | Status | Data |
|---|---|---|
| Facebook & Instagram | Connected | Optimized |
| **Google & YouTube** | **Connected** | **Optimized** |
| Judge.me Reviews | Connected | Always on |
| Microsoft Channel | Connected | Optimized |
| Pinterest | Connected | Optimized |
| TikTok | Connected | Optimized |

- **Custom pixels:** None

### Website Source Verification
```
AW-853411529: ✅ FOUND in page HTML
gtag.js:       ✅ FOUND in page HTML
GTM:            ❌ NOT found (using gtag.js directly)
```

---

## Campaigns

| Campaign | Status | Cost | Clicks | Conversions |
|---|---|---|---|---|
| USA + 2 Cold Traffic Search | Active | $175-347 | 1,342-2,996 | 143-190 |
| Re-targeting | Active | $2-60 | 26-177 | 12-18 |
| Target CPA Experiment - United Kingdom Mobile | Paused | $0 | 0 | 0 |
| Target CPA Experiment - USA Dynamic Targeting | Paused | $0 | 0 | 0 |
| USA Cold Traffic Search #2 | Paused | — | — | — |
| USA Shopping 2022 | Paused | — | — | — |
| Shopping Uk & Canada | Paused | — | — | — |
| Shopping United States | Paused | — | — | — |
| Shopping Rest of World | Paused | — | — | — |

---

## Recommended Fix Plan

### Priority 1: Fix Merchant Center Suspension 🔴
1. Go to Google Merchant Center (ID: 124884876)
2. Request re-review or contact Google support
3. Fix logo issues (upload conforming 1:1 and 2:1 logos)
4. **This is blocking all Shopping campaigns and likely affecting Google Shopping App conversion tracking**

### Priority 2: Consolidate Conversion Actions 🟡
**DELETE or set to Secondary (observation-only):**
- ❌ `Purchases from google analytics data` — UA is deprecated since July 2023
- ❌ `Android installs (all other apps)` — irrelevant for e-commerce
- ❌ `Search button from website that came adwords` — obscure, no value
- ❌ `Payment Info visit from adwords` — redundant with Begin Checkout

**KEEP as Primary (choose ONE per event type):**

| Event | Recommended Primary | Retire |
|---|---|---|
| Purchase | Google Shopping App Purchase | Purchases from google Adwords (legacy) |
| Add to Cart | Google Shopping App Add To Cart | Add To Cart button click from adwords (legacy) |
| Begin Checkout | Google Shopping App Begin Checkout | Begin Checkout from adwords (legacy) |
| Page View | Google Shopping App Page View | People that viewed products on website (legacy) |

**Rationale:** The "Google Shopping App" actions are managed by the Shopify Google & YouTube app and will auto-fire through the web pixel. The legacy "from adwords" actions require manual event snippets that no longer exist in the theme.

### Priority 3: Verify Shopify Pixel is Firing 🟡
After fixing Merchant Center:
1. Use Google Tag Assistant (https://tagassistant.google.com/) to verify events fire on:
   - Product page load (page_view)
   - Add to cart click
   - Checkout initiation
   - Purchase completion
2. If events are still not firing, try disconnecting and reconnecting the Google & YouTube app pixel

### Priority 4: Re-enable Begin Checkout and Page View Goals 🟢
Both "Begin checkout" and "Page view" goals show "0 of 84 campaigns" — they need to be enabled for campaign-level use:
1. Go to Goals > Summary > Begin checkout > Edit goal > Enable as account-default
2. Same for Page view

### Priority 5: Clean Up Enhanced Conversions 🟢
Navigate to Goals > Conversions > Diagnostics and address the enhanced conversions issues.

---

## Key Findings Summary

| Finding | Status |
|---|---|
| Google tag on website | ✅ Present (AW-853411529 via gtag.js) |
| Google & YouTube app connected | ✅ Connected to testhqfinds@gmail.com |
| Shopify pixel firing | ⚠️ Connected but not delivering conversion data |
| Google Merchant Center | 🔴 SUSPENDED |
| Old manual conversion tags | 🔴 Event snippets no longer in theme code |
| Shopify-managed conversion actions | 🔴 All showing 0 conversions (Secondary status) |
| Legacy "from adwords" actions | 🔴 No recent conversions (event snippets removed) |
| GA Universal Analytics import | 🔴 Deprecated — remove |
| Enhanced conversions | ⚠️ Needs attention |
| Consent mode | ✅ Excellent |
| Duplicate conversion actions | ⚠️ 6 duplicate pairs need consolidation |

---

*Report generated by Clawdbot subagent on 2026-01-26*
