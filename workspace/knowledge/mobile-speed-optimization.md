---
version: "1.0"
created: "2026-01-29"
updated: "2026-01-29"
verified: "2026-01-29"
confidence: "medium"
---

# Mobile Speed Optimization Guide - Dress Like Mommy

**Created:** January 29, 2026  
**Current LCP:** 12.2 seconds (Target: <2.5s)  
**Priority:** HIGH (affects SEO + conversions)

---

## The Problem

Mobile LCP of 12.2s is **catastrophic**:
- Google recommends <2.5s for "Good"
- 2.5-4s is "Needs Improvement"
- >4s is "Poor"
- **We're nearly 5x the "Poor" threshold**

This kills:
- 📉 SEO rankings (Core Web Vital)
- 💸 Conversion rates (53% abandon if >3s)
- 😤 User experience

---

## Quick Wins (Do First)

### 1. Image Optimization (Biggest Impact)

**Issue:** Large uncompressed images are the #1 cause of slow LCP.

**Fix:**
1. Go to **Shopify Admin > Settings > Files**
2. Check image sizes - any over 500KB need compression
3. Use Shopify's built-in image optimization (already enabled)
4. For hero images: max 1200px wide, under 200KB

**Apps that help:**
- TinyIMG (free tier available)
- Crush.pics

### 2. Reduce Hero Banner Size

**Current Issue:** Hero images likely too large for mobile.

**Fix:**
1. Theme Settings > Image banner > Banner height: **Small** (not Medium/Large)
2. Use images optimized for mobile (800px wide max)
3. Consider text-only hero on mobile

### 3. Disable Unused Apps

**Check:** Apps > Review each app's impact

**Common speed killers:**
- Review apps with heavy JavaScript
- Pop-up apps
- Recommendation engines
- Chat widgets loading immediately

**Action:** Disable or delay-load non-essential apps

### 4. Lazy Loading

**Dawn theme** has lazy loading built-in, but verify:
1. Theme Settings > check "Lazy load images" is ON
2. Hero/above-fold images should NOT be lazy loaded

---

## Medium Effort Fixes

### 5. Font Optimization

**Issue:** Custom fonts block rendering.

**Fix options:**
1. Use system fonts (fastest)
2. Add `font-display: swap` to custom fonts
3. Limit to 2 font weights max

### 6. Reduce Third-Party Scripts

**Check for:**
- Google Analytics (necessary, keep)
- Facebook Pixel (necessary, keep)
- Hotjar/tracking (consider removing)
- Multiple chat apps (pick one)
- Abandoned cart apps (check performance)

### 7. Enable Browser Caching

**Shopify handles most caching, but:**
1. Check Settings > Checkout > Enable caching
2. Use a CDN app if not on Shopify Plus

---

## Technical Fixes (Developer Level)

### 8. Defer Non-Critical JavaScript

In theme.liquid, change scripts from:
```html
<script src="app.js"></script>
```
To:
```html
<script src="app.js" defer></script>
```

### 9. Preload Critical Assets

Add to theme.liquid head:
```html
<link rel="preload" href="hero-image.jpg" as="image">
<link rel="preload" href="main-font.woff2" as="font" crossorigin>
```

### 10. Minimize CSS

- Remove unused CSS from theme
- Inline critical CSS
- Defer non-critical CSS

---

## Testing Tools

| Tool | URL | Use For |
|------|-----|---------|
| PageSpeed Insights | pagespeed.web.dev | Overall score + recommendations |
| GTmetrix | gtmetrix.com | Detailed waterfall |
| WebPageTest | webpagetest.org | Real device testing |

**Test on Mobile mode specifically!**

---

## Priority Action Plan

### This Week
1. [ ] Compress all images over 200KB
2. [ ] Set hero banner to "Small" height
3. [ ] Audit and disable unused apps
4. [ ] Verify lazy loading is enabled

### Next Week
1. [ ] Test with app X disabled, measure impact
2. [ ] Optimize fonts
3. [ ] Review third-party scripts

### Ongoing
- Run PageSpeed test monthly
- Check after adding any new app
- Monitor Core Web Vitals in Search Console

---

## Expected Results

| Fix | Expected LCP Improvement |
|-----|-------------------------|
| Image optimization | 2-4 seconds |
| Reduce hero size | 1-2 seconds |
| Disable slow apps | 1-3 seconds |
| Font optimization | 0.5-1 second |
| Script defer | 0.5-1 second |

**Realistic target:** Get from 12.2s to 4-6s with quick wins, then to <2.5s with full optimization.

---

## Resources

- [Shopify Speed Guide](https://help.shopify.com/en/manual/online-store/store-speed)
- [Google Core Web Vitals](https://web.dev/vitals/)
- [Dawn Theme Speed Tips](https://bemeapps.com/blogs/how-to-reduce-lcp-on-mobile-with-the-dawn-theme-in-shopify/)
