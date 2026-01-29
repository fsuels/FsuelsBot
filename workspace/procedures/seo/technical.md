---
version: "1.0"
created: "2026-01-29"
updated: "2026-01-29"
verified: "2026-01-29"
confidence: "high"
type: "procedure"
---

# Technical SEO Procedure

> **Verification Gate:** Before proceeding, state: "I have read the technical SEO procedure. The three pillars are: crawlability (sitemap/robots), page speed (under 3s), and mobile optimization (responsive design)."

## Purpose
Ensure search engines can crawl, index, and rank your site effectively.

## Prerequisites
- Google Search Console access (dresslikemommy.com verified)
- Shopify admin access
- Basic understanding of sitemaps and robots.txt

## Tools/Resources
- **Google Search Console:** Search performance, indexing, crawl errors
- **PageSpeed Insights:** google.com/pagespeedinghts
- **Mobile-Friendly Test:** search.google.com/test/mobile-friendly
- **Robots.txt:** yourdomain.com/robots.txt
- **Sitemap:** yourdomain.com/sitemap.xml

---

## Step-by-Step Procedure

### Part 1: Crawlability

#### Step 1: Verify Sitemap
- [ ] Visit `https://dresslikemommy.com/sitemap.xml`
- [ ] Confirm it loads and shows all pages
- [ ] Shopify auto-generates sitemap including:
  - Products
  - Collections
  - Pages
  - Blog posts

#### Step 2: Submit Sitemap to Google
- [ ] Go to Google Search Console
- [ ] Navigate to Sitemaps (left menu)
- [ ] Add sitemap URL: `sitemap.xml`
- [ ] Click Submit
- [ ] Verify status shows "Success"

#### Step 3: Check Robots.txt
- [ ] Visit `https://dresslikemommy.com/robots.txt`
- [ ] Shopify default should show:
```
User-agent: *
Disallow: /admin
Disallow: /cart
Disallow: /orders
Disallow: /checkouts/
Disallow: /carts/
Disallow: /account
Sitemap: https://dresslikemommy.com/sitemap.xml
```
- [ ] Ensure important pages are NOT disallowed
- [ ] Edit via: Online Store > Themes > Actions > Edit code > robots.txt.liquid

#### Step 4: Check Indexing Status
- [ ] In Google Search Console, go to Pages > Indexing
- [ ] Review "Not indexed" pages
- [ ] Common issues to fix:
  - "Discovered - currently not indexed" → Add internal links
  - "Crawled - currently not indexed" → Improve content quality
  - "Duplicate without canonical" → Check canonical tags

---

### Part 2: Page Speed Optimization

#### Step 5: Run PageSpeed Test
- [ ] Go to pagespeed.web.dev
- [ ] Test homepage URL
- [ ] Test one product page
- [ ] Test one collection page
- [ ] Record scores (target: 70+ mobile, 90+ desktop)

#### Step 6: Optimize Images (Primary Speed Factor)
- [ ] Ensure all images under 200KB (see `images.md`)
- [ ] Use Shopify's auto-compression
- [ ] Consider lazy loading (usually built into Shopify themes)

#### Step 7: Minimize Apps
- [ ] Go to Apps in Shopify admin
- [ ] Review installed apps
- [ ] Remove unused apps (each adds JavaScript)
- [ ] Disable app features you don't use

#### Step 8: Theme Optimization
- [ ] Use a well-optimized theme (Dawn, Craft, or similar)
- [ ] Limit homepage sections (10-15 max)
- [ ] Limit featured products/collections shown
- [ ] Avoid heavy sliders/carousels if possible

#### Step 9: Enable Browser Caching
- [ ] Shopify handles this automatically
- [ ] Verify by checking response headers for `Cache-Control`

---

### Part 3: Mobile Optimization

#### Step 10: Run Mobile-Friendly Test
- [ ] Go to search.google.com/test/mobile-friendly
- [ ] Test homepage and key pages
- [ ] Should show "Page is usable on mobile"

#### Step 11: Check Mobile Usability in Search Console
- [ ] Go to Experience > Mobile Usability
- [ ] Fix any flagged issues:
  - "Text too small to read"
  - "Clickable elements too close together"
  - "Content wider than screen"

#### Step 12: Manual Mobile Check
- [ ] Open site on actual phone
- [ ] Test navigation, filters, checkout
- [ ] Ensure text is readable without zooming
- [ ] Verify all buttons are tappable

---

### Part 4: URL & Site Structure

#### Step 13: Check URL Structure
Shopify URLs follow this pattern:
- Products: `/products/[handle]`
- Collections: `/collections/[handle]`
- Pages: `/pages/[handle]`
- Blog: `/blogs/[blog-name]/[post-handle]`

- [ ] Ensure all handles are clean and keyword-rich
- [ ] Avoid changing existing URLs (breaks links)
- [ ] If you must change, set up 301 redirects

#### Step 14: Set Up Redirects (If Needed)
- [ ] Go to Online Store > Navigation > URL Redirects
- [ ] Add redirects for any changed URLs
- [ ] Format: Old URL → New URL (301 redirect)

#### Step 15: Check for Duplicate Content
- [ ] Shopify can create duplicates via:
  - `/products/handle` vs `/collections/name/products/handle`
- [ ] Shopify adds canonical tags automatically
- [ ] Verify canonical in page source: `<link rel="canonical" href="...">`

---

### Part 5: HTTPS & Security

#### Step 16: Verify HTTPS
- [ ] Confirm site loads with `https://`
- [ ] Check for mixed content warnings (http resources on https page)
- [ ] Shopify provides free SSL automatically

#### Step 17: Check Security Headers
- [ ] Use securityheaders.com to scan
- [ ] Shopify handles most security headers
- [ ] No action needed unless issues found

---

## Monthly Technical SEO Audit Checklist

- [ ] Check Google Search Console for new errors
- [ ] Review Core Web Vitals in Search Console
- [ ] Run PageSpeed test on key pages
- [ ] Check for new 404 errors
- [ ] Verify sitemap is updating with new products
- [ ] Review mobile usability issues
- [ ] Check indexing status of new pages

---

## Quality Criteria
✅ Sitemap submitted and status "Success"  
✅ No critical robots.txt blocks  
✅ PageSpeed score 70+ mobile  
✅ Mobile-friendly test passes  
✅ No indexing errors for important pages  
✅ HTTPS working properly  
✅ Clean URL structure  

---

## Common Mistakes to Avoid
❌ Blocking important pages in robots.txt  
❌ Never submitting sitemap to Google  
❌ Ignoring PageSpeed (slow sites rank lower)  
❌ Not checking mobile experience  
❌ Changing URLs without redirects  
❌ Installing too many apps (speed killer)  
❌ Using unoptimized theme  

---

## Shopify Technical SEO Advantages
- Auto-generated sitemap
- Auto-canonical tags
- Auto-SSL/HTTPS
- Built-in mobile responsiveness (with good theme)
- Auto-redirects when you change handles (asks if you want redirect)

## Shopify Technical SEO Limitations
- Limited robots.txt control (edit via theme code)
- Can't change URL structure (stuck with /products/, /collections/)
- Limited server-side optimization options
- App bloat can slow site significantly
