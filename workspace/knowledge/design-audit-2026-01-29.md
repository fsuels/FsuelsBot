---
version: "1.0"
created: "2026-01-29"
updated: "2026-01-29"
verified: "2026-01-29"
confidence: "medium"
---

# DressLikeMommy.com Design Audit
**Date:** January 29, 2026
**Auditor:** Claude (Subagent)

---

## Executive Summary

DressLikeMommy.com has a functional e-commerce site but **lacks visual impact and modern e-commerce conventions** that drive conversions. The site feels sparse, generic, and doesn't communicate the emotional value proposition of matching family outfits.

**Overall Score: 5/10** (Functional but needs significant improvements)

---

## Page-by-Page Analysis

### 1. Homepage

**Current State:**
- No hero banner or visual hook above the fold
- Goes directly into category listings (Mommy & Me, Family Matching, etc.)
- Category images are extremely faded/washed out (possible CSS or lazy-loading issue)
- Trust signals only in small announcement bar ("Free Shipping · Best Prices · Top Quality · Secure Checkout")
- No featured products shown
- No customer testimonials or social proof
- No prominent CTA button

**Above-the-Fold Issues:**
- ❌ No emotional hook (lifestyle imagery showing happy families)
- ❌ No clear value proposition beyond generic "matching outfits"
- ❌ No compelling CTA ("Shop Valentine's Day Matching" etc.)
- ❌ Category thumbnails barely visible (faded to near-white)

**PatPat Comparison:**
- ✅ Full-width hero with family lifestyle photo at beach
- ✅ Clear headline: "Matching That Travels Well"
- ✅ "Best Sellers" section with star ratings
- ✅ "Why everyone loves PatPat" testimonials
- ✅ User-generated content ("Spotted on PatPat Families")
- ✅ Loyalty rewards program prominent

### 2. Collection Pages (Valentine's Day)

**Current State:**
- Large block of SEO text takes up entire above-the-fold area
- **NO products visible without scrolling**
- Filter options present but tiny
- Products only show after extensive scroll

**Issues:**
- ❌ SEO text wall dominates (good for Google, bad for users)
- ❌ Products hidden below fold - visitors may bounce thinking collection is empty
- ❌ No collection banner image
- ❌ Product count ("4 products") hidden in small text

**Recommendations:**
- Move SEO text to accordion/expandable section OR bottom of page
- Show product grid immediately above the fold
- Add collection hero banner with lifestyle image

### 3. Product Pages

**Current State:**
- Clean layout with product images on left, details on right
- "91 sold - High demand product" badge ✅
- "Only 9 left" urgency text ✅
- Shop Pay installment option shown ✅
- Free shipping worldwide with delivery estimate ✅
- Detailed size chart ✅
- Return policy and security sections (expandable)

**Missing/Issues:**
- ❌ No customer reviews section
- ❌ No "You may also like" recommendations
- ❌ Product images are flat (white background) - no lifestyle photos showing the outfit worn
- ❌ Only one color option visible
- ❌ No size guide link near size selector
- ❌ No "Complete the Look" cross-sells

### 4. Cart (Not Captured)

*Unable to evaluate cart page this session*

---

## E-Commerce Best Practices Comparison

| Element | DressLikeMommy | PatPat | Bailey's Blossoms |
|---------|----------------|--------|-------------------|
| Hero Banner | ❌ None | ✅ Full-width lifestyle | ✅ Yes |
| Lifestyle Photos | ❌ Minimal | ✅ Extensive | ✅ Yes |
| Customer Reviews | ❌ None visible | ✅ Star ratings | ✅ Yes |
| Trust Badges | ⚠️ Text only | ✅ Icons + text | ✅ Yes |
| Email Popup/Discount | ❌ No | ✅ 15% off popup | ✅ Yes |
| Loyalty Program | ❌ No | ✅ PatPat Rewards | ✅ Yes |
| UGC/Social Proof | ❌ No | ✅ Instagram feed | ✅ Yes |
| Mobile Optimization | ⚠️ Unknown | ✅ App available | ✅ Good |
| Product Recommendations | ❌ No | ✅ Yes | ✅ Yes |
| Size Guide | ✅ Table in description | ✅ Interactive | ✅ Yes |

---

## Critical Issues (Must Fix)

### 1. **Homepage Image Loading Problem** 🔴
Category images are nearly invisible (opacity issue or lazy load failure). This is breaking the site's visual appeal. **Fix immediately.**

### 2. **Collection Pages Bury Products** 🔴
SEO text takes entire above-fold area. Visitors see no products and may bounce. **Move text below products or into accordion.**

### 3. **No Social Proof** 🔴
No reviews, no testimonials, no Instagram feed, no "X customers bought this." Kills trust and conversions.

---

## Design Recommendations

### Quick Wins (1-2 hours each)

1. **Fix homepage image opacity** - Check CSS, ensure images load properly
2. **Add a homepage hero banner** - Use Canva to create lifestyle banner with CTA button
3. **Move collection SEO text** - Put it at bottom or in expandable accordion
4. **Add trust badge icons** - Use free icons for shipping, returns, secure checkout
5. **Add "You may also like"** - Enable Shopify's built-in product recommendations

### Medium Effort (Day projects)

6. **Add review app** - Install Judge.me (free) or Loox for product reviews
7. **Create lifestyle product photos** - Show families wearing outfits (use AI or commission)
8. **Email capture popup** - "Get 10% off your first order" popup
9. **Homepage "Best Sellers" section** - Show actual products on homepage
10. **Add announcement bar rotation** - Highlight free shipping + current sale

### Major Changes (Week+ projects)

11. **Theme upgrade** - Consider a premium Shopify theme built for fashion (Dawn is basic)
12. **Instagram feed integration** - Show real customer photos
13. **Loyalty/rewards program** - Encourage repeat purchases
14. **Blog content** - "5 Valentine's Day Photo Ideas for Matching Families"
15. **Mobile-first redesign** - Ensure mobile experience is flawless

---

## Top 5 Priorities

### 🥇 1. Fix Homepage Images (URGENT)
The faded/invisible category images make the site look broken. Check theme settings or CSS for opacity issues.

### 🥈 2. Add Hero Banner to Homepage
Create a lifestyle banner showing a happy family in matching outfits. Add a clear CTA: "Shop Valentine's Matching 💕"

### 🥉 3. Move Collection SEO Text Below Products
Products must be visible above the fold. SEO text can go in an accordion or at page bottom.

### 4. Install Review App
Social proof is critical. Judge.me is free and adds star ratings + customer reviews.

### 5. Add Product Recommendations
Enable "You may also like" on product pages. Shopify has this built-in; just needs activation.

---

## Visual Mockup Descriptions

### Proposed Homepage Layout

```
┌────────────────────────────────────────────────────┐
│ 🚚 FREE SHIPPING ON ALL ORDERS │ ❤️ Valentine's Sale │  <- Rotating announcement
├────────────────────────────────────────────────────┤
│ [Logo]     SHOP  MOMMY&ME  DADDY&ME  FAMILY  SALE │  <- Simplified nav
├────────────────────────────────────────────────────┤
│                                                    │
│   [HERO BANNER - Family in matching outfits]       │
│   "Match Your Mini-Me This Valentine's Day"        │
│           [SHOP VALENTINE'S COLLECTION →]          │
│                                                    │
├────────────────────────────────────────────────────┤
│  ★ BEST SELLERS                                    │
│  [Product] [Product] [Product] [Product]           │
│  ⭐4.9     ⭐4.8     ⭐4.7     ⭐4.9               │
│  $24.99   $19.99   $16.99   $29.99               │
├────────────────────────────────────────────────────┤
│  🛒 SHOP BY CATEGORY                               │
│  [Mommy&Me] [Family] [Daddy&Me] [Couples]          │
├────────────────────────────────────────────────────┤
│  💬 WHAT FAMILIES ARE SAYING                       │
│  "Cutest matching outfits!" - Sarah M. ⭐⭐⭐⭐⭐     │
│  "Fast shipping, great quality" - Mike P. ⭐⭐⭐⭐⭐   │
├────────────────────────────────────────────────────┤
│  📸 #DRESSLIKEMOMMY - [Instagram Grid]             │
├────────────────────────────────────────────────────┤
│  [Footer with trust badges, policies, etc.]        │
└────────────────────────────────────────────────────┘
```

### Proposed Product Page Additions

```
Current: [Images] [Title, Price, Add to Cart]

Add below Add to Cart:
┌─────────────────────────────┐
│ ✅ Free Shipping            │
│ 🔄 Easy 30-Day Returns      │
│ 🔒 Secure Checkout          │
└─────────────────────────────┘

Add below description:
┌─────────────────────────────┐
│ ⭐⭐⭐⭐⭐ 4.8 (47 reviews)     │
│ "My daughter and I get      │
│ compliments everywhere!"    │
│ - Jessica T.                │
│ [Read all reviews →]        │
└─────────────────────────────┘

Add at page bottom:
┌─────────────────────────────┐
│ 💕 Complete the Look        │
│ [Matching shoes] [Headbands]│
└─────────────────────────────┘
┌─────────────────────────────┐
│ 👀 You May Also Like        │
│ [Product] [Product] [Prod]  │
└─────────────────────────────┘
```

---

## Competitor Reference Sites

1. **PatPat** (patpat.com) - Market leader, excellent UX
2. **Bailey's Blossoms** (baileysblossoms.com) - Strong brand, lifestyle focus
3. **The Trendy Toddlers** (thetrendytoddlers.com) - Clean, modern
4. **Carters** (carters.com) - Trust signals, reviews
5. **Primary.com** - Minimalist, excellent product photography

---

## Action Items for Francisco

- [ ] Investigate homepage image opacity issue (theme bug?)
- [ ] Create hero banner in Canva with Valentine's theme
- [ ] Install Judge.me or similar review app
- [ ] Enable Shopify product recommendations
- [ ] Consider theme upgrade budget

---

*Audit complete. Questions? Ask Claude.*
