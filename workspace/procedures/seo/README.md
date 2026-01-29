# SEO Procedure — Standardized Workflow

> **Trigger words:** seo, meta tags, keywords, sitemap, schema, rankings, optimization
> **Source:** `knowledge/seo-strategy-2026.md` (1,336 lines of research)
> **Last updated:** 2026-01-29

## ⚠️ VERIFICATION GATE

Before ANY SEO work, state this in your response:
> "SEO Procedure verified. Working in [BATCH NAME] phase. Checklist loaded."

If you cannot state this, STOP and read this file first.

---

## How This Works

When Francisco says **"fix all SEO"** or similar:
1. Run a FULL AUDIT first (Batch 0)
2. Generate a prioritized fix list
3. Work through fixes in BATCHES (not all at once)
4. Verify each fix before moving to next
5. Report progress after each batch

**NEVER** try to fix everything in one pass. Systematic batches = nothing missed.

---

## 🏆 The 80/20 Checklist (Council Consensus)

**7 items that cover ~80% of SEO value:**

1. ✅ GSC verified + sitemap submitted
2. ✅ No noindex/password blocking key pages  
3. ✅ Clean titles/H1s/metas on templates (fix once, applies everywhere)
4. ✅ 150+ words unique copy on top collections
5. ✅ Image compression + descriptive ALT text
6. ✅ 404s fixed + redirects working
7. ✅ Valid Product schema (no critical errors)

**If you only have 30 minutes, focus on these 7.**

---

## 🔒 Golden Rule

> **Never skip verification. If you need speed, reduce batch size — not QA.**

*Source: Council consensus (Grok + ChatGPT + Gemini all agreed)*

---

## Batch Structure

| Batch | Name | Scope | Batch Size | Typical Time |
|-------|------|-------|------------|--------------|
| 0 | Audit | Scan everything, create fix list | Full site | 5-10 min |
| 1 | Critical | Core Web Vitals, crawl errors | All blockers | 15-30 min |
| 2 | Technical | Schema, sitemap, robots, redirects | All technical | 20-30 min |
| 3 | Templates | Fix title/meta/H1 at template level | 5-10 templates | 20-30 min |
| 4 | Products | Individual product optimization | **20-25 products** | 30-60 min |
| 5 | Collections | Collection pages SEO | **10 collections** | 20-30 min |
| 6 | Images | Compression + ALT text | **100 images** | 30-45 min |
| 7 | Content | Blog posts, guides, FAQs | 2-4 pieces | 60-90 min |

**Priority Order:** Technical → Templates → Products → Collections → Images → Content
*(Fix system-wide issues before individual pages)*

---

## Batch 0: AUDIT (Always First)

Run this every time before fixing anything.

### Checklist
```
□ Check Google Search Console for errors
□ Run PageSpeed Insights on homepage + 1 product page
□ Check all products have: title, description, images
□ Check all collections have: title, description
□ Count products missing meta descriptions
□ Count images missing alt text
□ Check for duplicate titles/descriptions
□ Note current Core Web Vitals scores
```

### Output
Create `memory/seo-audit-YYYY-MM-DD.md` with:
- Current scores (LCP, CLS, INP)
- Error count by category
- Priority fix list (ordered)
- Estimated total work

### Verification
> "Audit complete. Found [X] critical, [Y] high, [Z] medium issues. Starting Batch 1."

---

## Batch 1: CRITICAL FIXES

Fix these first — they block everything else.

### Checklist
```
□ LCP > 2.5s? → Image optimization, lazy loading, preload hero
□ CLS > 0.1? → Add image dimensions, fix layout shifts
□ Crawl errors in GSC? → Fix broken links, 404s
□ Sitemap submitted? → Submit to GSC if not
□ Robots.txt blocking important pages? → Fix
□ HTTPS everywhere? → Check for mixed content
```

### Specifications
| Metric | Target | Current | Action |
|--------|--------|---------|--------|
| LCP | ≤ 2.5s | [measure] | [fix if needed] |
| INP | ≤ 200ms | [measure] | [fix if needed] |
| CLS | ≤ 0.1 | [measure] | [fix if needed] |

### Verification
After each fix, re-run PageSpeed Insights and confirm improvement.

---

## Batch 2: TECHNICAL SEO

### Checklist
```
□ Product schema JSON-LD on all products
□ Organization schema on homepage
□ BreadcrumbList schema on product/collection pages
□ FAQ schema on FAQ page (if exists)
□ Sitemap includes all products/collections/pages
□ No duplicate content issues
□ Canonical tags correct
□ Hreflang tags (if multi-market)
□ 301 redirects working (no chains)
```

### Schema Template (Product)
```json
{
  "@context": "https://schema.org",
  "@type": "Product",
  "name": "[PRODUCT TITLE]",
  "image": ["[IMAGE_URL]"],
  "description": "[META DESCRIPTION]",
  "brand": {"@type": "Brand", "name": "Dress Like Mommy"},
  "offers": {
    "@type": "Offer",
    "price": "[PRICE]",
    "priceCurrency": "USD",
    "availability": "https://schema.org/InStock"
  }
}
```

### Verification
Use Google Rich Results Test on 3 random products.

---

## Batch 3: ON-PAGE SEO

Work through ALL products and pages systematically.

### Title Tag Formula
```
[Primary Keyword] - [Secondary Keyword] | Dress Like Mommy
```
- **Length:** 50-60 characters (max 580 pixels)
- **Include:** Primary keyword near start
- **Avoid:** Keyword stuffing, all caps

### Meta Description Formula
```
[Benefit/Hook]. [What it is]. [Call to action]. Shop [keyword] at Dress Like Mommy!
```
- **Length:** 150-160 characters (max 920 pixels)
- **Include:** Primary keyword, call to action
- **Avoid:** Duplicate descriptions, generic text

### H1 Rules
- One H1 per page (usually product/collection title)
- Include primary keyword
- 20-70 characters

### URL Handle Rules
- 3-5 words max
- Primary keyword included
- Hyphens between words
- No dates, no filler words

### Checklist (Per Product)
```
□ Title tag: 50-60 chars, keyword near start
□ Meta description: 150-160 chars, has CTA
□ H1: Matches title intent, keyword included
□ URL handle: Short, keyword included
□ No duplicate of another product's meta
```

### Batch Processing
Process products in groups of 10:
1. List 10 products
2. Check each against checklist
3. Fix issues
4. Verify fixes
5. Move to next 10

### Verification
> "Batch 3 progress: [X]/[Total] products optimized. [Y] remaining."

---

## Batch 4: CONTENT & IMAGES

### Product Description Rules
- **Length:** 300-500 words
- **Structure:** Benefits → Features → Specs → CTA
- **Keywords:** Primary + 2-3 related, natural placement
- **Avoid:** Duplicate supplier descriptions, thin content

### Image Alt Text Formula
```
[Color] [Product Type] for [Audience] - [Brand or Style Detail]
```
Example: "Pink floral matching dress for mom and daughter - summer collection"

- **Length:** Under 125 characters
- **Include:** What's in the image, keyword if relevant
- **Avoid:** "Image of...", keyword stuffing, empty alt tags

### Image Optimization
| Type | Max Size | Format | Dimensions |
|------|----------|--------|------------|
| Hero | 150KB | WebP | 1920x1080 max |
| Product | 100KB | WebP | 1000x1000 |
| Thumbnail | 30KB | WebP | 400x400 |

### Checklist (Per Product)
```
□ Description: 300+ words, unique, keyword-rich
□ All images have alt text
□ Images compressed (<100KB)
□ No missing images
□ No duplicate descriptions
```

### Verification
> "Batch 4 progress: [X]/[Total] products have optimized content."

---

## Batch 5: COLLECTION PAGES

### Collection Description Rules
- **Length:** 200-400 words
- **Placement:** Top of collection page
- **Include:** What's in collection, who it's for, why buy
- **Keywords:** Collection-level keywords

### Collection Meta
- Title: "[Collection Name] | [Category] | Dress Like Mommy"
- Description: Describe collection, include CTA

### Checklist (Per Collection)
```
□ Has custom meta title (not auto-generated)
□ Has custom meta description
□ Has 200+ word description on page
□ Products properly categorized
□ No empty collections
```

---

## Batch 6: ADVANCED OPTIMIZATION

### Internal Linking
```
□ Related products linked on each product page
□ Blog posts link to relevant products
□ Collection pages link to subcollections
□ No orphan pages (0 internal links)
□ Breadcrumbs implemented
```

### Content Gaps
```
□ Size guide page exists
□ FAQ page exists
□ Shipping info page exists
□ About page optimized
□ Contact page has schema
```

### Speed Optimization
```
□ Unused apps removed
□ Custom fonts minimized
□ Third-party scripts audited
□ Images use lazy loading
□ Critical CSS inlined
```

---

## Reporting Template

After completing any batch, report:

```
## SEO Progress Report — [DATE]

**Batch completed:** [BATCH NAME]
**Products touched:** [X]
**Issues fixed:** [Y]
**Remaining work:** [Z]

### Before/After
| Metric | Before | After |
|--------|--------|-------|
| Products with meta | X% | Y% |
| Images with alt | X% | Y% |
| LCP score | X | Y |

### Next batch:** [BATCH NAME] — estimated [TIME]
```

---

## Frequency

| Task | Frequency |
|------|-----------|
| Full audit (Batch 0) | Monthly |
| New product SEO | Per product added |
| Collection SEO | Per collection added |
| Core Web Vitals check | Weekly |
| Schema validation | Monthly |
| Content refresh | Quarterly |

---

## Quick Reference

### Character Limits
- Title: 50-60 chars
- Meta description: 150-160 chars
- Alt text: <125 chars
- URL handle: 3-5 words

### Core Web Vitals Targets
- LCP: ≤ 2.5 seconds
- INP: ≤ 200 milliseconds
- CLS: ≤ 0.1

### Image Sizes
- Hero: <150KB
- Product: <100KB
- Thumbnail: <30KB

---

## Files Created By This Procedure

- `memory/seo-audit-YYYY-MM-DD.md` — Audit results
- `memory/seo-fixes-YYYY-MM-DD.md` — Fix log
- `knowledge/seo-strategy-2026.md` — Full research (reference)

---

*This procedure ensures systematic, repeatable SEO optimization. Nothing gets missed.*
