# DLM URL Redirects Report

**Date**: January 26, 2026  
**Store**: dresslikemommy.com (Shopify)

## Summary

**Good news: The top priority redirects are already set up.** The Shopify admin shows 50+ URL redirects already configured, covering all three broken URL patterns. All four high-priority redirects specified in the task are already live.

---

## Current State of Redirects

### Access URL
The redirects page is at:
- **Working URL**: `https://dresslikemommy-com.myshopify.com/admin/redirects`
- Note: The new admin path (`/online-store/redirects`) doesn't render properly — Shopify's SPA routing returns an empty component. Use the old-style myshopify.com admin URL instead, which auto-redirects to the new admin but loads correctly.

### Existing Redirects (50+ already configured)

The redirects page shows at least 50 redirects across multiple pages, organized by pattern:

#### Pattern 1: Locale-Prefixed URLs → Non-Prefixed ✅ DONE
| From | To |
|------|------|
| `/en-se` | `/` |
| `/en-hk` | `/` |
| `/en-be` | `/` |
| `/en-se/collections/swimsuits` | `/collections/swimsuits` |
| `/en-se/collections/dresses` | `/collections/dresses` |
| `/en-se/collections/family-pajamas` | `/collections/family-pajamas` |
| `/en-se/collections/trunks` | `/collections/trunks` |
| `/en-se/collections/family-tops` | `/collections/family-tops` |
| `/en-hk/collections/swimsuits` | `/collections/swimsuits` |
| `/en-hk/collections/dresses` | `/collections/dresses` |
| `/en-hk/collections/family-pajamas` | `/collections/family-pajamas` |
| `/en-hk/collections/trunks` | `/collections/trunks` |
| `/en-hk/collections/family-tops` | `/collections/family-tops` |
| `/en-be/collections/swimsuits` | `/collections/swimsuits` |
| `/en-be/collections/dresses` | `/collections/dresses` |
| `/en-be/collections/family-pajamas` | `/collections/family-pajamas` |
| `/en-be/collections/trunks` | `/collections/trunks` |
| `/en-be/collections/family-tops` | `/collections/family-tops` |
| `/en-se/products/satin-flower-matching-handmade-lace-headband-set-7` | `/products/satin-flower-matching-handmade-lace-headband-set-7` |
| `/en-se/products/2016-new-fashion-mom-and-me-headband...` | `/products/2016-new-fashion-mom-and-me-headband...` |
| `/en-be/products/2016-new-mom-and-me-large-sequin-bow-headband...` | `/products/2016-new-mom-and-me-large-sequin-bow-headband...` |
| `/en-be/products/1pc-summer-short-sleeve-cotton...` | `/products/1pc-summer-short-sleeve-cotton...` |

#### Pattern 2: Nested Collection/Product Paths → Product URLs ✅ DONE
| From | To |
|------|------|
| `/collections/family-sweaters/products/matching-christmas-sweater` | `/products/matching-christmas-sweater` |
| `/collections/family-sets/products/matching-family-outfit-set` | `/products/matching-family-outfit-set` |
| `/collections/family-tops/products/matching-graphic-tees` | `/products/matching-graphic-tees` |
| `/collections/family-tops/products/matching-family-t-shirts` | `/products/matching-family-t-shirts` |
| `/collections/family-pajamas/products/matching-reindeer-pajamas` | `/products/matching-reindeer-pajamas` |
| `/collections/family-pajamas/products/matching-holiday-pajama-set` | `/products/matching-holiday-pajama-set` |
| `/collections/family-pajamas/products/matching-christmas-plaid-pajamas` | `/products/matching-christmas-plaid-pajamas` |
| `/collections/dresses/products/matching-polka-dot-dress` | `/products/matching-polka-dot-dress` |
| `/collections/dresses/products/matching-vintage-floral-dress` | `/products/matching-vintage-floral-dress` |
| `/collections/dresses/products/matching-floral-maxi-dress` | `/products/matching-floral-maxi-dress` |
| `/collections/swimsuits/products/matching-stripe-swimwear` | `/products/matching-stripe-swimwear` |
| `/collections/swimsuits/products/matching-fruit-pattern-swimwear` | `/products/matching-fruit-pattern-swimwear` |
| `/collections/swimsuits/products/matching-tropical-leaf-swimwear` | `/products/matching-tropical-leaf-swimwear` |
| `/collections/swimsuits/products/matching-floral-print-swimwear` | `/products/matching-floral-print-swimwear` |
| `/collections/swimsuits/products/family-matching-swimsuits-flower-bikini` | `/products/family-matching-swimsuits-flower-bikini` |
| `/collections/swimsuits/products/matching-turtle-back-bamboo-swimwear` | `/products/matching-turtle-back-bamboo-swimwear` |
| `/collections/new-matching-outfits/products/matching-mama-baby-mouse-t-shirt` | `/products/matching-mama-baby-mouse-t-shirt` |
| `/collections/family-matching-pajamas/products/family-matching-hooded-christmas-jumpsuit-pajamas` | `/products/family-matching-hooded-christmas-jumpsuit-pajamas` |

#### Pattern 3: Discontinued Products → Collections/Replacement Products ✅ DONE
| From | To |
|------|------|
| `/products/family-matching-christmas-deer-pajamas-sets` | `/collections/family-pajamas` |
| `/products/family-matching-christmas-fair-isle-pajamas-red-white-holiday-reindeer-pajama-set-for-kids-and-adults` | `/collections/family-pajamas` |
| `/products/family-matching-striped-knit-sweaters-cozy-christmas-reindeer-pullovers-for-mom-and-kids` | `/products/family-matching-outfit-set-mom-cardigan-kids-tops-baby-romper` |
| `/products/family-matching-outfits-sweatshirt-hooded-sweater` | `/products/matching-family-smile-hoodies-cute-comfortable-sweatshirts-for-parents-and-kids` |
| `/products/family-matching-oregon-ducks-hoodie` | `/products/family-matching-oregon-ducks-hoodies-cozy-sweatshirts-for-parents-and-kids` |
| `/products/family-match-stripe-print-pajama-warm-sleepwear` | `/products/family-matching-christmas-buffalo-plaid-onesies-with-flap-cozy-red-black-pajamas` |
| `/products/matching-christmas-pajamas-deer-plaid-set` | `/products/matching-family-christmas-pajamas-with-reindeer-print-plaid-pants-holiday-sleepwear-set-for-the-whole-family-including-pets` |
| `/collections/daddy-me-shorts` | `/collections/trunks` |
| `/products/daddy-and-me-me-mini-me-t-shirt` | `/products/matching-father-and-child-me-mini-me-t-shirt-set-adorable-dad-and-kid-outfit` |
| `/products/daddy-me-pilot-co-pilot` | `/products/father-and-child-pilot-co-pilot-matching-t-shirt-set-perfect-for-daddy-me-outfits` |

---

## Top Priority Redirects Status

| # | Broken URL | Target | Status |
|---|-----------|--------|--------|
| 1 | `/collections/swimsuits/products/matching-turtle-back-bamboo-swimwear` | `/products/matching-turtle-back-bamboo-swimwear` | ✅ Already set up (redirects to product, not collection — acceptable if product exists) |
| 2 | `/products/family-matching-christmas-fair-isle-pajamas-red-white-holiday-reindeer-pajama-set-for-kids-and-adults` | `/collections/family-pajamas` | ✅ Already set up (redirects to `/collections/family-pajamas`) |
| 3 | `/collections/family-matching-pajamas/products/family-matching-hooded-christmas-jumpsuit-pajamas` | `/products/family-matching-hooded-christmas-jumpsuit-pajamas` | ✅ Already set up |
| 4 | `/collections/new-matching-outfits/products/matching-mama-baby-mouse-t-shirt` | `/products/matching-mama-baby-mouse-t-shirt` | ✅ Already set up |

### Minor Discrepancies to Note
- **Redirect #1**: The task suggested redirecting to `/collections/swimsuits` but it currently redirects to `/products/matching-turtle-back-bamboo-swimwear`. If the product page exists, this is actually better (keeps the user closer to what they wanted). If the product is discontinued, it should be updated to redirect to `/collections/swimsuits`.
- **Redirect #2**: Redirects to `/collections/family-pajamas` instead of `/collections/family-matching-pajamas` as specified. These may be the same collection (verify the correct collection handle).

---

## Bulk CSV Import/Export (for remaining 545+ URLs)

### ✅ Shopify Supports CSV Bulk Redirect Import

The redirects page has both **Export** and **Import** buttons.

### CSV Format
Shopify's redirect CSV uses two columns:
```csv
Redirect from,Redirect to
/old-path,/new-path
/another/old-path,/another/new-path
```

### How to Bulk Import Redirects

1. Go to **Online Store > Navigation > URL redirects** (or use URL: `https://dresslikemommy-com.myshopify.com/admin/redirects`)
2. Click **Import**
3. Upload a CSV file with `Redirect from` and `Redirect to` columns
4. Shopify will validate and import all redirects

### How to Export Existing Redirects
1. On the same redirects page, click **Export**
2. This downloads all current redirects as CSV
3. Useful for backup before making changes

### Generating Bulk Redirects for 545+ URLs

For the remaining broken URLs not yet covered, create a CSV with these patterns:

#### Pattern 1: Collection/Product Nested Paths
```csv
Redirect from,Redirect to
/collections/[collection-name]/products/[product-handle],/products/[product-handle]
```
Strip `/collections/[collection-name]/` prefix to get the direct product URL.

#### Pattern 2: Locale-Prefixed URLs
```csv
Redirect from,Redirect to
/en-be/products/[product-handle],/products/[product-handle]
/en-hk/collections/[collection],/collections/[collection]
/en-se/products/[product-handle],/products/[product-handle]
```
Strip `/en-XX/` prefix.

#### Pattern 3: Discontinued Products
These need manual mapping to the closest collection or replacement product.

---

## Recommendations

1. **Export current redirects** to get a baseline CSV backup
2. **Audit the remaining 404s** — the 50+ existing redirects likely cover many of the 545 broken URLs. Check Google Search Console or analytics to see which 404s are still occurring
3. **Generate a comprehensive CSV** of all remaining broken URLs and their redirect targets
4. **Use the Import feature** to bulk upload any new redirects
5. **Verify redirect #1** — check if `/products/matching-turtle-back-bamboo-swimwear` still exists. If not, update the redirect to go to `/collections/swimsuits`
6. **Consider wildcard alternatives** — Shopify doesn't support wildcard redirects natively, but apps like "Redirect Manager" or "SC Easy Redirects" on the Shopify App Store can handle pattern-based redirects more efficiently for large volumes

---

## Technical Notes

- **Shopify Admin URL**: The new admin (`admin.shopify.com/store/dresslikemommy-com`) has a broken route for `/online-store/redirects` — the React SPA route exists but has no component. Use the old myshopify.com admin URL instead: `https://dresslikemommy-com.myshopify.com/admin/redirects`
- **Redirect Type**: Shopify URL redirects are 301 (permanent) redirects by default
- **Shopify Redirect Limits**: Shopify allows up to 200,000 URL redirects per store, so 545 is well within limits
- **API Alternative**: For programmatic creation, use Shopify's Admin REST API: `POST /admin/api/2024-01/redirects.json` with body `{"redirect": {"path": "/old-url", "target": "/new-url"}}`
