# Website Speed Audit: dresslikemommy.com
**Date:** January 29, 2026
**Tested by:** Lux (subagent)
**Tool:** Google PageSpeed Insights (Lighthouse 13.0.1)

---

## Executive Summary

| Metric | Mobile | Desktop | Target |
|--------|--------|---------|--------|
| **Performance Score** | 54 ⚠️ | 71 ⚠️ | 90+ |
| **Accessibility** | 97 ✅ | 97 ✅ | 90+ |
| **Best Practices** | 92 ✅ | 92 ✅ | 90+ |
| **SEO** | 100 ✅ | 100 ✅ | 90+ |

**Verdict:** Mobile performance is the critical issue. Desktop is acceptable but has layout shift problems.

---

## Core Web Vitals

### Mobile (Moto G Power, Slow 4G)
| Metric | Value | Rating | Target |
|--------|-------|--------|--------|
| First Contentful Paint (FCP) | 2.7s | ⚠️ Needs Improvement | < 1.8s |
| Largest Contentful Paint (LCP) | **12.2s** | 🔴 POOR | < 2.5s |
| Total Blocking Time (TBT) | 430ms | ⚠️ Needs Improvement | < 200ms |
| Cumulative Layout Shift (CLS) | 0.067 | ✅ Good | < 0.1 |
| Speed Index (SI) | 5.8s | ⚠️ Needs Improvement | < 3.4s |

### Desktop (Custom throttling)
| Metric | Value | Rating | Target |
|--------|-------|--------|--------|
| First Contentful Paint (FCP) | 0.4s | ✅ Good | < 1.8s |
| Largest Contentful Paint (LCP) | 1.2s | ✅ Good | < 2.5s |
| Total Blocking Time (TBT) | 150ms | ✅ Good | < 200ms |
| Cumulative Layout Shift (CLS) | **0.463** | 🔴 POOR | < 0.1 |
| Speed Index (SI) | 1.8s | ✅ Good | < 3.4s |

---

## Key Issues Identified

### 🔴 Critical Issues

#### 1. Mobile LCP is Catastrophic (12.2s)
- **Impact:** 10x slower than target
- **Likely cause:** Hero images and above-the-fold images not optimized for mobile
- **Solution:** Ensure hero/banner images have mobile-specific sizes, use next-gen formats (WebP)

#### 2. Desktop CLS is Extremely Poor (0.463)
- **Impact:** Nearly 5x the acceptable threshold
- **Likely cause:** Images without explicit width/height, late-loading fonts, dynamic content injection
- **Solution:** Add explicit dimensions to all images, preload critical fonts, reserve space for dynamic elements

### ⚠️ Major Issues

#### 3. Enormous Network Payload (~3MB)
- Mobile: 3,129 KiB total
- Desktop: 2,998 KiB total
- **Impact:** Slow load times, especially on mobile networks
- **Breakdown likely:** Large images, excessive JavaScript from apps/theme

#### 4. Image Delivery Needs Work
- Mobile potential savings: 579 KiB
- Desktop potential savings: 798 KiB
- **Actions:**
  - Convert images to WebP format (Shopify does this automatically for most cases)
  - Ensure proper image sizing (not serving 2000px images on 400px containers)
  - Add lazy loading to below-the-fold images

#### 5. Unused JavaScript
- Mobile: 327 KiB unused
- Desktop: 234 KiB unused
- **Likely sources:** Theme JavaScript, app scripts
- **Solution:** Audit which apps inject scripts, defer non-critical JS

#### 6. Render Blocking Requests (Mobile only)
- Potential savings: 420ms
- **Impact:** Delays first paint
- **Solution:** Inline critical CSS, defer non-critical stylesheets

### ℹ️ Minor Issues

#### 7. Inefficient Cache Lifetimes
- ~125 KiB of resources have short cache TTLs
- **Impact:** Repeat visitors re-download resources unnecessarily

#### 8. Legacy JavaScript (~13 KiB)
- Some JS not using modern syntax
- Minor impact but worth noting

#### 9. Long Main-Thread Tasks
- Mobile: 11 long tasks
- Desktop: 8 long tasks
- **Impact:** Contributes to TBT and sluggish interactivity

#### 10. Non-Composited Animations (3 found)
- **Impact:** Animation performance, may contribute to CLS
- **Solution:** Use CSS transform/opacity instead of layout properties

---

## Installed Apps (Potential Script Bloat)

| App | Purpose | Speed Impact | Recommendation |
|-----|---------|--------------|----------------|
| **BuckyDrop** | Dropshipping fulfillment | Medium | KEEP - Core business function |
| **Judge.me Reviews** | Customer reviews | Medium | KEEP - Important for conversions |
| **FeedAPIs For Bing Shopping** | Product feed | Low-Medium | EVALUATE - Check if actively using |
| **Translate & Adapt** | Translations | Low | KEEP if multilingual needed |
| **Search & Discovery** | Shopify's search | Low | KEEP - Native Shopify, optimized |
| **Messaging** | Shopify messaging | Low | KEEP - Native Shopify |

**Note:** No bloat from excessive apps. App count is reasonable (6 apps).

---

## What I Fixed

**Nothing could be directly fixed via browser automation.** All optimizations require:
- Shopify admin theme customizer access
- Theme code edits (liquid/CSS/JS)
- Image re-uploads
- App configuration changes

---

## Recommended Actions for Francisco

### 🔴 Priority 1: Fix Mobile LCP (Biggest Impact)

1. **Check hero image settings in theme customizer:**
   - Online Store → Themes → Customize → Homepage
   - Look for hero/banner section settings
   - Enable responsive images if available
   - Consider smaller/optimized hero for mobile

2. **Image optimization:**
   - Re-upload hero images at optimized sizes
   - Target: Desktop 1920px max, Mobile 768px max
   - Use TinyPNG or similar before upload

### 🔴 Priority 2: Fix Desktop CLS

1. **Add explicit dimensions to images:**
   - In theme settings, ensure images have width/height attributes
   - May require theme code edit: add `width` and `height` to `<img>` tags

2. **Identify layout shift culprits:**
   - Watch the page load slowly (throttle network in DevTools)
   - Note what elements "jump" around
   - Usually: images, fonts, dynamic content blocks

### ⚠️ Priority 3: Reduce Payload

1. **Review Judge.me settings:**
   - Check if loading minimal widget vs full suite
   - Disable features not actively used

2. **Check if Bing Shopping app is necessary:**
   - If not running Bing ads, consider removing FeedAPIs app

3. **Theme settings:**
   - Disable animations if excessive
   - Review number of products shown per page (fewer = faster)

### ℹ️ Priority 4: Caching & Other

1. **Browser caching is mostly controlled by Shopify CDN** - limited control here
2. **Consider lazy loading for product galleries** - check theme settings
3. **Enable "Preload" for critical resources** in theme if available

---

## Quick Wins Available Now

- [ ] **Resize hero/banner images** - Upload smaller versions
- [ ] **Check theme's "Lazy loading" setting** - Enable if available
- [ ] **Reduce products per page** - Try 12 instead of 24 if applicable
- [ ] **Remove Point of Sale** - Not used for online-only store (no script impact, but cleaner)

---

## Re-Test Schedule

Recommend re-testing after changes:
1. After hero image optimization → Check LCP
2. After layout shift fixes → Check CLS
3. After app review → Check payload size

Target: Get mobile performance to 70+ and desktop to 85+

---

## Raw Data References

- PageSpeed report URL: `https://pagespeed.web.dev/analysis/https-dresslikemommy-com/6zztfh5wmi`
- Test date: Jan 29, 2026, 1:16 AM EST
- Lighthouse version: 13.0.1
- Chrome version: HeadlessChromium 137.0.7151.119
