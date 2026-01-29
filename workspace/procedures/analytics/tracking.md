# Analytics Tracking Procedure

## Revenue Impact
What gets measured gets improved. Without tracking:
- You're guessing which products to promote
- You don't know which ads are wasting money
- You can't identify conversion leaks

---

## Essential Tracking Setup

### 1. Google Analytics 4 (GA4)

**Install**
1. Create GA4 property
2. Add Shopify GA4 integration (Settings → Apps → Google)
3. Enable Enhanced E-commerce

**Must Track**
- Page views
- Add to cart
- Begin checkout
- Purchase (with revenue)
- Product views

### 2. Facebook/Meta Pixel

**Install**
1. Create pixel in Meta Business Manager
2. Add via Shopify Sales Channels → Facebook
3. Verify events are firing

**Must Track**
- PageView
- ViewContent (product views)
- AddToCart
- InitiateCheckout
- Purchase (with value)

### 3. Pinterest Tag

**Install**
1. Create tag in Pinterest Business
2. Add via Shopify app or manual
3. Enable Enhanced Match

**Must Track**
- Page visits
- Add to cart
- Checkout
- Purchase

### 4. Google Ads Conversion Tracking

**Install**
1. Create conversion action in Google Ads
2. Add tag via Shopify or GTM
3. Import from GA4 (recommended)

---

## UTM Tracking

**Always use UTMs for campaigns**

Format: `?utm_source=X&utm_medium=Y&utm_campaign=Z`

| Source | Medium | Example |
|--------|--------|---------|
| facebook | paid | FB Valentine campaign |
| instagram | organic | IG bio link |
| email | email | Welcome series |
| pinterest | organic | Pin clicks |
| google | cpc | Google Shopping |

**Example**
```
https://dresslikemommy.com/collections/valentine?utm_source=email&utm_medium=email&utm_campaign=valentine_launch
```

---

## Verification Checklist

```
□ GA4 installed and receiving data
□ Meta Pixel firing on all events
□ Pinterest Tag verified
□ Google Ads conversions tracking
□ UTMs on all marketing links
□ Test purchase tracked correctly
```

---

## Tools

- **Google Tag Manager** - Central tag management
- **Meta Events Manager** - Verify FB/IG tracking
- **Pinterest Tag Helper** - Chrome extension
- **GA4 DebugView** - Real-time testing

---

## Quick Win

**Right now**: Do a test purchase and verify it shows up in:
1. Shopify Analytics
2. GA4
3. Meta Events Manager
4. Pinterest Analytics

If any are missing, fix immediately. You're flying blind otherwise.
