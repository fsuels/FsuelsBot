# Tag Duplication Audit — dresslikemommy.com
**Date:** January 27, 2026 | **Audited by:** Clawdbot  
**Method:** Site source code analysis + platform dashboard cross-verification

---

## VERIFIED SUMMARY

| Platform | Tag ID on Site | Tag ID in Platform | Match? | Firing? | Duplicated? | Status |
|----------|---------------|-------------------|--------|---------|-------------|--------|
| Google Analytics (GA4) | G-N4EQNK0MMB | G-N4EQNK0MMB | ✅ | ✅ Active 48h | ❌ No dupe | ✅ CLEAN |
| Google Ads | AW-853411529 | AW-853411529 (acct 399-097-6848) | ✅ | ✅ | ❌ No dupe | ✅ CLEAN |
| Google Merchant Center | MC-MQ104D130Y | MC-MQ104D130Y | ✅ | ✅ | ❌ No dupe | ✅ CLEAN |
| Facebook Pixel | 547553035448852 | 547553035448852 (active) | ✅ | ✅ Last event 1hr ago | ❌ No dupe | ✅ CLEAN |
| Microsoft/Bing UET | 36005151 | 36005151 (ShopifyImport) | ✅ | ✅ | ⚠️ Duplicate HTML tags | ⚠️ CLEANUP |
| Pinterest | Config exists (2620007050621) | N/A | N/A | ❌ NOT firing | N/A | ❌ SETUP INCOMPLETE |
| TikTok | Config exists (CCGG1MRC77UB2PF1KBE0) | N/A | N/A | ❌ NOT firing | N/A | ❌ SETUP INCOMPLETE |

---

## CROSS-VERIFICATION DETAILS

### ✅ Google Analytics (GA4) — VERIFIED CLEAN
- **Site tag:** G-N4EQNK0MMB (via Shopify Google & YouTube app pixel #216367201)
- **GA4 Dashboard:** Property "dresslikemommy.com - GA4", Stream ID 4030905738
- **Measurement ID in GA4:** G-N4EQNK0MMB ✅ MATCH
- **Data status:** "Receiving traffic in past 48 hours" ✅
- **Enhanced measurement:** ON (page views, scrolls, outbound clicks + 3 more)
- **Connected site tags:** 0 (no extra tags piggybacking)
- **Network:** 1x gtag.js load, 1x collect event per page
- **Verdict:** Single tag, correct ID, receiving data. NO DUPLICATES.

### ✅ Google Ads — VERIFIED CLEAN
- **Site tag:** AW-853411529 (via Google & YouTube app pixel, same as GA4)
- **Google Ads Dashboard:** Account 399-097-6848 (testhqfinds@gmail.com)
- **Conversion tag ID:** AW-853411529 ✅ MATCH
- **Conversion actions:** Purchase, Add to Cart, Begin Checkout, Page View, Search, Payment Info (all configured)
- **Network:** 1x destination script load
- **Note:** "Install a Google tag" banner shows in Ads because tag is installed via Shopify app (not manual snippet), but it IS working
- **Verdict:** Single tag, correct ID. NO DUPLICATES.

### ✅ Facebook Pixel — VERIFIED CLEAN
- **Site tag:** 547553035448852 (via Shopify Facebook & Instagram app pixel #64127073)
- **Facebook Events Manager:** Dataset "Dresslikemommy.com's Pixel", ID 547553035448852 ✅ MATCH
- **Data status:** PageView last received 1 hour ago, 4.8K events in last 28 days
- **Events:** PageView, ViewContent, AddToCart, InitiateCheckout, Search, Purchase, AddPaymentInfo — ALL active
- **Integrations:** Conversions API + Meta Pixel (dual setup)
- **Second pixel exists:** 406906276537460 — DEAD (no activity in 2,495 days, no integrations, no website). NOT on the site. Not a concern.
- **Network:** 1x fbevents.js + 1x signals/config (normal), 1x /tr event per page
- **fbq() function:** Available on page ✅
- **Verdict:** Single active pixel, correct ID. NO DUPLICATES.

### ⚠️ Microsoft/Bing UET — VERIFIED, NEEDS CLEANUP
- **Site tag:** 36005151 only (ShopifyImport)
- **Old tag 36000629:** NOT on the site ✅ (active in MS Ads dashboard but not installed)
- **Deleted tags 4003544 & 4003545:** NOT on the site ✅ (inactive in dashboard)
- **HTML issue:** `bat.bing.com/bat.js` injected 2x in `<head>` + `bingshoppingtool` proxy 2x eager + 2x lazy-load
- **Network reality:** Browser deduplicates — only 1 actual script execution
- **Events fired:** 1x pageLoad + 1x dedup event per page (NORMAL)
- **UET object:** Single instance (type: UET)
- **WPM pixel config:** Present (#931561569, ti: 36005151)
- **Impact:** No double-counting of conversions. Duplicate HTML tags waste ~50KB bandwidth per page.
- **Fix:** Uninstall/reinstall Microsoft Channel app in Shopify to clean up duplicate script injection
- **Verdict:** Functionally correct, but messy HTML. Low priority fix.

### ❌ Pinterest — SETUP NEVER COMPLETED
- **Shopify app status:** Connected in Customer Events, "Optimized" data access
- **WPM config:** Tag ID 2620007050621 registered
- **Pinterest app page:** Shows "Finish setting up the Pinterest sales channel" + "Your website does not meet all of Pinterest's Merchant Guidelines"
- **Site presence:** ZERO — no pintrk function, no Pinterest scripts, no network requests
- **Reason:** Setup was started but never finished. Pinterest hasn't approved the merchant account.
- **Impact:** No Pinterest conversion tracking or audience building. If you run Pinterest ads, there's ZERO measurement.
- **Fix:** Open Pinterest app in Shopify → "Continue setup" → complete merchant verification

### ❌ TikTok — SETUP NEVER COMPLETED
- **Shopify app status:** Connected in Customer Events, "Optimized" data access
- **WPM config:** Pixel code CCGG1MRC77UB2PF1KBE0 registered
- **TikTok app page:** Shows "Finish Setup" — permissions not yet approved
- **Site presence:** ZERO — no ttq function, no TikTok scripts, no network requests
- **Reason:** Setup was started but never completed. TikTok permissions not approved.
- **Impact:** No TikTok conversion tracking or audience building. If you run TikTok ads, there's ZERO measurement.
- **Fix:** Open TikTok app in Shopify → "Finish Setup" → approve permissions → complete integration

---

## DATA INTEGRITY ASSESSMENT

### ✅ SAFE TO TRUST (for decisions)
- **Google Analytics (GA4):** Data is accurate. Single tag, no duplicates, receiving real traffic.
- **Google Ads:** Conversion data flows correctly through Shopify's Google & YouTube app. Single tag. Note: some older conversion actions show "Needs attention" — cleanup recommended but not a duplication issue.
- **Facebook Pixel:** Data is accurate. Single pixel, events firing for all key actions (page view, view content, add to cart, checkout, purchase). Conversions API + Meta Pixel dual integration.

### ⚠️ PARTIALLY RELIABLE
- **Microsoft/Bing:** Tag fires correctly (single UET ID, no double-counting), but the duplicate HTML scripts are sloppy. Data is trustworthy.

### ❌ NO DATA AVAILABLE
- **Pinterest:** Zero tracking. No data to trust or distrust — it simply isn't collecting anything.
- **TikTok:** Zero tracking. Same — no data exists.

---

## RECOMMENDED ACTIONS (Priority Order)

1. **[HIGH] Complete Pinterest setup** if planning to use Pinterest marketing
2. **[HIGH] Complete TikTok setup** if planning to use TikTok marketing
3. **[MEDIUM] Microsoft cleanup** — uninstall/reinstall Microsoft Channel app to fix duplicate HTML tags
4. **[LOW] Delete old Facebook pixel** 406906276537460 in Events Manager (dead weight, not causing issues)
5. **[LOW] Deactivate old MS Ads UET tag** 36000629 in dashboard (not on site, but good hygiene)

---

*Report verified by cross-checking: site HTML source code, browser network requests, JavaScript global objects (window.uetq, window.fbq, window.gtag, window.pintrk, window.ttq), Shopify Customer Events settings, Shopify Web Pixel Manager configs, Google Analytics Admin, Google Ads Conversions, Facebook Events Manager, Pinterest Shopify app, TikTok Shopify app.*
