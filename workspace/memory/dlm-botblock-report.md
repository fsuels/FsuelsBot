# DressLikeMommy.com — Bot Traffic Blocking Report

**Date:** 2026-01-26  
**Issue:** 55% of all traffic (1,134 users) from China with zero engagement — clear bot traffic.  
**Store ships to:** USA, UK, Canada, Australia only.

---

## 🔧 Changes Made in Shopify Admin

### 1. Markets Disabled (Set to Draft)

| Market | Regions | Previous Status | New Status |
|--------|---------|----------------|------------|
| **International** | 131 regions (includes China, and most countries globally) | ✅ Active | 📝 Draft |
| **Eurozone** | 43 regions (European countries) | ✅ Active | 📝 Draft |
| **Estonia** | 1 region | 📝 Draft | 📝 Draft (no change) |
| **United States** | 1 region (USA) | ✅ Active | ✅ Active (no change) |

**Impact:** With International and Eurozone markets set to Draft, visitors from those 174 regions (including China) will no longer see localized pricing/currencies or be served market-specific content. The store's online presence is now limited to the United States market by default.

> ⚠️ **Note:** The UK, Canada, and Australia are NOT currently in their own dedicated Active markets. They fall under the now-drafted International market. Consider creating dedicated markets for UK, Canada, and Australia if you want those customers to have localized experiences (local currency, etc.).

### 2. Shipping Configuration (Observed — No Changes Made)

**Shipping Zones:**
- **Zone 1 "Countries"** (Epacket): United States, Australia, Canada, France, Israel, Norway, Russia, Saudi Arabia, Ukraine, United Kingdom
  - Standard Shipping (5-12 Days): **Free**
  - Premium Shipping (4-8 Days): **$12.99** (0-5 lb)
- **Zone 2 "Rest of world"**: Rest of World
  - Standard Shipping (5-12 Days): **Free**
  - Premium Shipping (4-8 Days): **$12.99** (0-5 lb)

**Fulfillment Location:**
- **China Warehouse** via BuckyDrop App — SFD UID5347, Guangzhou, 510900 Guangdong, China

> ⚠️ **"Rest of World" zone still active** — technically any country can still get shipping rates at checkout. This doesn't block bots from visiting but does mean anyone worldwide could technically place an order.

### 3. Bot Protection / IP Blocking (Shopify Admin)

**Shopify does NOT offer native IP blocking or geo-blocking features.** There is no built-in setting in the Shopify admin to block traffic from specific countries or IP ranges.

---

## 📋 Recommendations for Additional Blocking

### Priority 1: Cloudflare (Strongest Protection)

If the domain uses Cloudflare DNS (or can be moved to it):

1. **Enable Bot Fight Mode** (free) — blocks known bot traffic
2. **Create Firewall Rules** to block China:
   - Rule: If `ip.geoip.country eq "CN"` → Block
   - Can also block other non-target countries
3. **Enable Under Attack Mode** temporarily during heavy bot attacks
4. **Rate Limiting** — limit requests per IP per minute

### Priority 2: Shopify App Solutions

Install a bot protection / geo-blocking app from the Shopify App Store:
- **Blockify** — country-based blocking, IP blocking, VPN blocking
- **Fraud Filter** / **FraudBlock** — blocks suspicious orders
- **Mechanic** — automation platform that can block by country

### Priority 3: GA4 Data Filters

To clean up analytics data:
1. Go to GA4 > Admin > Data Streams > Configure tag settings
2. Create an **Internal Traffic** filter for known bot IPs
3. Use **Data Filters** to exclude bot/China traffic from reports
4. Create a **custom segment** excluding China to see clean metrics

### Priority 4: robots.txt & Meta Tags

Add to your Shopify theme's `robots.txt` (limited control in Shopify):
- This won't stop malicious bots but helps with crawlers

### Priority 5: Review BuckyDrop Connection

The store fulfills from a **China warehouse via BuckyDrop**. The Chinese bot traffic may be related to:
- BuckyDrop's service pinging the store
- Chinese supplier/competitor scraping product data
- Automated systems associated with the fulfillment pipeline

Consider contacting BuckyDrop support to understand if their platform generates store visits.

---

## Current Market State Summary

```
United States  → ACTIVE (only market now active)
International  → DRAFT (was Active — 131 regions including China ✅ DISABLED)
Eurozone       → DRAFT (was Active — 43 European regions ✅ DISABLED)
Estonia        → DRAFT (was already Draft)
```

## 🎯 Next Steps

1. **Create dedicated markets** for UK, Canada, Australia (currently no active markets for them)
2. **Install a geo-blocking app** like Blockify to actively block Chinese IPs
3. **Consider removing "Rest of World" shipping zone** to only allow checkout from target countries
4. **Monitor GA4** over the next 7 days to see if Chinese traffic drops after market changes
5. **Set up Cloudflare** for the strongest layer of bot protection
