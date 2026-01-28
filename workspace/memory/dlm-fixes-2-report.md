# DressLikeMommy.com — Audit Fixes Report (Jan 26, 2026)
## Subagent: dlm-fixes-2

---

## 1. 🔴 404 PAGES — BROKEN URLs (CRITICAL)

**Scale of problem:** 562 page views (20.82% of ALL views) and 565 users (27.36%) are hitting 404 pages. This is the **#1 most-viewed "page"** on the entire site.

### Top Broken URLs by Views:
| Views | Broken URL |
|-------|-----------|
| 9 | `/collections/swimsuits/products/matching-turtle-back-bamboo-swimwear` |
| 4 | `/products/family-matching-christmas-fair-isle-pajamas-red-white-holiday-reindeer-pajama-set-for-kids-and-adults` |
| 2 | `/collections/family-matching-pajamas/products/family-matching-hooded-christmas-jumpsuit-pajamas` |
| 2 | `/collections/new-matching-outfits/products/matching-mama-baby-mouse-t-shirt` |
| 2 | `/en-be/products/1pc-summer-short-sleeve-cotton-family-matching-outfits-clothing-family-look-dresses-for-mother-and-daughter-beach-dress-s2860` |
| 2 | `/en-be/products/2016-new-mom-and-me-large-sequin-bow-headband-set-hair-accessories-mommy-and-me-big-bow-headband-cotton-turban-headband-1set-13` |
| 2 | `/en-hk/collections/family-tops` |
| 2 | `/en-hk/collections/trunks` |
| 2 | `/en-se/products/2016-new-fashion-mom-and-me-headband-turban-headband-pair-set-top-knotted-headband-set-baby-and-mommy-cotton-headwrap-set-1-set-5` |
| 2 | `/en-se/products/satin-flower-matching-handmade-lace-headband-set-7` |
| 2 | `/products/family-matching-christmas-deer-pajamas-sets` |

### Three Main Patterns:
1. **Nested `/collections/*/products/*` paths** (most common) — Shopify serves products at `/products/*` not nested under collections. These come from old Google index or internal links with the wrong format.
2. **Locale-prefixed URLs** (`/en-be/`, `/en-hk/`, `/en-se/`) — International locale URLs that don't exist on this Shopify store.
3. **Discontinued/removed products** — Old products still indexed in Google.

### Total: 545 unique 404 URLs across 562 views (most have 1-2 views each — long tail)

### Recommendations:
- **Immediate:** Set up bulk Shopify URL redirects for the top 10-20 highest-traffic 404 paths → redirect to closest matching product/collection
- **For nested paths:** Create a redirect rule: `/collections/*/products/*` → `/products/*` (strip the collection prefix)
- **For locale URLs:** Create a redirect rule: `/en-*/...` → `/...` (strip locale prefix)
- **For discontinued products:** Redirect to relevant collection pages

---

## 2. 🟡 GOOGLE MERCHANT CENTER LOGOS

**Status:** Both logos are uploaded but **NOT APPROVED**.

**Rejection reason:** "The text in your logo must be readable on small screens. Try uploading a more simple logo, like your favicon."

**Current logos:** Both show the "Dress Like Mommy" text logo with dress silhouette icon. The text is too small/detailed to read at small ad sizes.

### Requirements:
| | Square Logo | Rectangular Logo |
|---|---|---|
| **Ratio** | 1:1 | 2:1 |
| **Min size** | 500 × 500 px | 1,000 × 500 px |
| **Max size** | 2,000 × 2,000 px | 2,000 × 1,000 px |
| **Format** | PNG, SVG, WEBP | PNG, SVG, WEBP |
| **Max file** | 5 MB | 5 MB |

### Colors configured:
- Main color: #fefefe (white)
- Accent color: #f7cac9 (light pink)

### Recommendation for Francisco:
- Create a **simplified version** of the logo — larger text, simpler design
- OR use just the dress silhouette icon (no text) for the square version
- OR use just "DLM" abbreviated text that's readable at small sizes
- The favicon approach Google suggests might work — just the dress icon without text

---

## 3. 🔴 FACEBOOK MESSENGER — UNREAD MESSAGES (URGENT)

**Total unread across all channels:**
- Messenger: **9** unread
- Instagram DMs: **13** unread
- Facebook comments: **4** unread
- Instagram comments: **10** unread
- WhatsApp: New (just set up)

### Visible Messenger Conversations (all have ONLY automated replies, no human response):

| # | Name | Date | Summary |
|---|------|------|---------|
| 1 | **⚠️ Peggy Spino** | Mar 20, 2025 | **URGENT** — Ordered Dec 10, 2024 (matching nightgowns for granddaughters). Never received. 3 messages over 3 months. Angry, wants refund or delivery. Paid by credit card. |
| 2 | Łukasz Sikora | Feb 23, 2025 | Auto-reply only |
| 3 | Patricia Mounier | Feb 22, 2025 | Auto-reply only |
| 4 | Michał Kuśmierz | Feb 20, 2025 | Auto-reply only |
| 5 | Mirella Mili | Feb 17, 2025 | Auto-reply only |
| 6 | Adam Bienkowski | Feb 17, 2025 | Auto-reply only |
| 7 | Claudia Hackman | Jan 28, 2025 | Message unavailable |
| 8 | Tina Pelletier Soucier | Jan 16, 2025 | Priority — Auto-reply only |

### Key Issues:
- **Peggy Spino is a chargeback risk** — she paid by credit card in Dec 2024 and never received the order. If she disputes with her credit card company, it could cause problems.
- NO human has responded to ANY of these messages — only the automated "We'll get back to you soon" response.
- Several names appear Polish/European (Łukasz, Michał, Adam, Mirella) — suggests European customers/interest.

### ⚡ Francisco needs to:
1. **Respond to Peggy Spino IMMEDIATELY** — resolve the Dec 2024 order or issue a refund
2. Review all 8+ conversations and respond where appropriate
3. Check the 13 Instagram DMs as well

---

## 4. 🔴 CHINESE BOT TRAFFIC (MASSIVE)

**Findings are worse than expected:**

| Country | Active Users | % of Total | Engagement Rate | Avg Time | Revenue |
|---------|-------------|-----------|----------------|----------|---------|
| **China** | **1,134** | **54.92%** | **0.97%** | **0s** | **$0.00** |
| United States | 779 | 37.72% | 18.35% | 12s | $64.98 |
| India | 22 | 1.07% | 52.17% | 25s | $0.00 |
| Canada | 18 | 0.87% | 38.1% | 1m 28s | $71.85 |

**China has 1,134 users (NOT 215 as originally estimated) — over HALF of all traffic is Chinese bots.**

Evidence it's bot traffic:
- 0.97% engagement rate (vs 18.35% US, 52% India, 38% Canada)
- 0 seconds average engagement time
- $0.00 revenue
- 0 key events
- 1,133 of 1,134 are "new users" (bots don't return)
- Only 11 engaged sessions out of 1,134 users

### Recommendations to Block:
1. **Shopify:** Add country-blocking or CAPTCHA for China (Settings > Markets — don't serve content to China if not selling there)
2. **GA4 Data Filter:** Admin > Data Settings > Data Filters — create a filter to exclude traffic from China (or create a filtered report view)
3. **Cloudflare/CDN:** If using Cloudflare, set up a firewall rule to block or challenge requests from China
4. **Google Ads:** Exclude China from geographic targeting (if running ads)
5. **robots.txt:** Won't help with sophisticated bots but can deter simple crawlers

---

## 5. 🟡 GOOGLE ADS CONVERSION ACTIONS

**Date range shown: Jan 1 – Dec 31, 2023** (historical data)

**⚠️ CRITICAL: Google Ads says "Install a Google tag on your website" — the Google Ads tag may not be properly installed on www.dresslikemommy.com**

### All 16 Conversion Actions:

#### Purchase Goal (4 actions):
| Action | Type | Source | Conversions | Value | Status |
|--------|------|--------|------------|-------|--------|
| Purchases from google Adwords | Primary | Website | 41 | $12,074 | No recent conversions |
| Google Shopping App Purchase | Primary | Website | 0 | $0 | No recent conversions |
| Purchases from google analytics data | Secondary | Website (GA UA) | 17 | $676 | No recent conversions |
| dresslikemommy.com - GA4 (web) purchase | Secondary | Website (GA4) | 6 | $719 | No recent conversions |

#### Add to Cart Goal (2 actions):
| Action | Type | Source | Conversions | Value | Status |
|--------|------|--------|------------|-------|--------|
| Add To Cart button click from adwords | Primary | Website | 491 | $19,378 | ⚠️ Needs attention |
| Google Shopping App Add To Cart | Secondary | Website | 220 | $5,950 | No recent conversions |

#### Begin Checkout Goal (2 actions):
| Action | Type | Source | Conversions | Value | Status |
|--------|------|--------|------------|-------|--------|
| Begin Checkout from adwords | Primary | Website | 46 | $2,425 | ⚠️ Needs attention |
| Google Shopping App Begin Checkout | Secondary | Website | 30 | $1,278 | No recent conversions |

#### Download Goal (1 action):
| Action | Type | Source | Conversions | Value | Status |
|--------|------|--------|------------|-------|--------|
| Android installs (all other apps) | Primary | Mobile App (Google Play) | 0 | $0 | No recent conversions |

#### Page View Goal (4 actions):
| Action | Type | Source | Conversions | Value | Status |
|--------|------|--------|------------|-------|--------|
| People that viewed products on website (no purchase) | Primary | Website | 32,609 | $0 | No recent conversions |
| Google Shopping App View Item | Secondary | Website | 4,401 | $0 | ⚠️ Needs attention |
| Google Shopping App Search | Secondary | Website | 3 | $0 | No recent conversions |
| Google Shopping App Page View | Secondary | Website | 0 | $0 | ⚠️ Needs attention |

#### Other Goal (3 actions):
| Action | Type | Source | Conversions | Value | Status |
|--------|------|--------|------------|-------|--------|
| Search button from website that came adwords | Primary | Website | 11 | $0 | ⚠️ Needs attention |
| Payment Info visit from adwords | Primary | Website | 8 | $0 | ⚠️ Needs attention |
| Google Shopping App Add Payment Info | Secondary | Website | 5 | $0 | ⚠️ Needs attention |

### Summary:
- **9 actions** = "No recent conversions" (haven't fired recently — dead)
- **7 actions** = "Needs attention" (have active issues requiring troubleshooting)
- **0 actions** are currently working properly

### Key Issues:
1. **Google Ads tag not installed** — the #1 issue. Without the tag, no conversions can fire.
2. **Duplicate tracking:** Has both old GA UA and new GA4 purchase tracking, plus separate "Google Shopping App" versions of many actions — these should be consolidated.
3. **"Begin checkout" not used in campaigns** — showing "0 of 84 campaigns"
4. **"Page view" and "Other" goals** — not used in any campaigns

### Recommendations:
1. **Install Google Ads tag** (or verify Google Tag Manager is firing it) — this is the root cause
2. **Consolidate conversion actions** — keep: GA4 purchase (primary), Add to Cart, Begin Checkout. Remove/deactivate duplicates.
3. **Remove irrelevant actions:** Android installs (no app exists), Search button, Google Shopping App variants (if not using Shopping app)
4. **Set up enhanced conversions** for better tracking accuracy

---

## PRIORITY ACTION ITEMS FOR FRANCISCO:

1. **🔴 URGENT: Respond to Peggy Spino** on Facebook Messenger — order from Dec 2024 unfulfilled
2. **🔴 Set up Shopify URL redirects** for top 404 pages — 21% of all page views are 404s
3. **🔴 Block Chinese bot traffic** — 55% of traffic is fake
4. **🟡 Install Google Ads tag** on the website to fix all 16 broken conversion actions
5. **🟡 Create simplified logos** for Google Merchant Center approval
6. **🟡 Review all Facebook/Instagram messages** — dozens of unread messages
