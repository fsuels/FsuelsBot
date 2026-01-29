---
version: "1.0"
created: "2026-01-29"
updated: "2026-01-29"
verified: "2026-01-29"
confidence: "high"
type: "procedure"
---

# Schema Markup Procedure

> **Verification Gate:** Before proceeding, state: "I have read the schema procedure. The key schema types for e-commerce are: Product (with price/availability), Organization, BreadcrumbList, and FAQ."

## Purpose
Add structured data to help search engines understand your content and enable rich results (stars, prices, availability in search).

## Prerequisites
- Shopify admin access
- Google Rich Results Test tool
- Understanding of what schema types are relevant

## Tools/Resources
- **Testing:** search.google.com/test/rich-results
- **Reference:** schema.org
- **Shopify:** Most themes include basic Product schema

---

## Step-by-Step Procedure

### Part 1: Audit Existing Schema

#### Step 1: Test Current Schema
- [ ] Go to search.google.com/test/rich-results
- [ ] Enter your homepage URL
- [ ] Enter a product page URL
- [ ] Enter a collection page URL
- [ ] Note what schema types are detected

#### Step 2: Check What Shopify Provides by Default
Most Shopify themes include:
- [ ] **Product schema** (on product pages)
  - Name, description, image
  - Price, currency
  - Availability (InStock/OutOfStock)
  - SKU, brand
- [ ] **Organization schema** (basic)
- [ ] **BreadcrumbList** (some themes)

### Part 2: Verify Product Schema

#### Step 3: Check Product Page Schema
- [ ] Open a product page
- [ ] View page source (Ctrl+U)
- [ ] Search for `"@type": "Product"` or `application/ld+json`
- [ ] Verify these fields are populated:
  - name
  - image
  - description
  - offers (with price, priceCurrency, availability)
  - brand (if applicable)

#### Step 4: Test in Rich Results Tool
- [ ] Test a product page URL
- [ ] Should show "Product" detected
- [ ] Check for warnings (yellow) or errors (red)
- [ ] Fix any errors in theme code or product data

**Expected Product Schema:**
```json
{
  "@context": "https://schema.org/",
  "@type": "Product",
  "name": "Heart Print Mommy and Me Matching Sweatshirt",
  "image": "https://cdn.shopify.com/...",
  "description": "Adorable matching sweatshirts for mommy and me...",
  "brand": {
    "@type": "Brand",
    "name": "Dress Like Mommy"
  },
  "offers": {
    "@type": "Offer",
    "price": "39.99",
    "priceCurrency": "USD",
    "availability": "https://schema.org/InStock",
    "url": "https://dresslikemommy.com/products/..."
  }
}
```

### Part 3: Add/Enhance Organization Schema

#### Step 5: Add Organization Schema
If not present, add to theme's `<head>`:
- [ ] Go to Online Store > Themes > Actions > Edit code
- [ ] Open `theme.liquid` or `layout/theme.liquid`
- [ ] Add before `</head>`:

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": "Dress Like Mommy",
  "url": "https://dresslikemommy.com",
  "logo": "https://dresslikemommy.com/path-to-logo.png",
  "sameAs": [
    "https://www.instagram.com/dresslikemommy",
    "https://www.facebook.com/dresslikemommy",
    "https://www.pinterest.com/dresslikemommy"
  ],
  "contactPoint": {
    "@type": "ContactPoint",
    "email": "support@dresslikemommy.com",
    "contactType": "customer service"
  }
}
</script>
```

### Part 4: Add Breadcrumb Schema (If Missing)

#### Step 6: Check for BreadcrumbList
- [ ] Test collection and product pages
- [ ] Look for BreadcrumbList in Rich Results
- [ ] If missing, consider adding via theme code

**Breadcrumb Schema Example:**
```json
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    {
      "@type": "ListItem",
      "position": 1,
      "name": "Home",
      "item": "https://dresslikemommy.com"
    },
    {
      "@type": "ListItem",
      "position": 2,
      "name": "Valentine's Day",
      "item": "https://dresslikemommy.com/collections/valentines"
    },
    {
      "@type": "ListItem",
      "position": 3,
      "name": "Heart Print Sweatshirt",
      "item": "https://dresslikemommy.com/products/heart-print-sweatshirt"
    }
  ]
}
```

### Part 5: Add FAQ Schema (For Relevant Pages)

#### Step 7: Add FAQ Schema to Product/Collection Pages
If you have FAQ sections, add schema:

```json
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "What sizes are available for mommy and me sets?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Our mommy sizes range from S-XXL, and mini sizes range from 2T-10Y..."
      }
    },
    {
      "@type": "Question",
      "name": "Do the outfits come as a set?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Yes, all our mommy and me outfits are sold as matching sets..."
      }
    }
  ]
}
```

### Part 6: Review Schema (If Applicable)

#### Step 8: Enable Product Reviews
- [ ] If using a reviews app, verify it adds Review schema
- [ ] Test product page for "aggregateRating"
- [ ] Reviews show as stars in search results

**Review Schema (usually added by app):**
```json
"aggregateRating": {
  "@type": "AggregateRating",
  "ratingValue": "4.8",
  "reviewCount": "127"
}
```

---

## Schema Testing Workflow

1. **Before changes:** Test page in Rich Results tool, screenshot
2. **Make changes:** Add/edit schema in theme code
3. **After changes:** Re-test in Rich Results tool
4. **Monitor:** Check Search Console for structured data errors

---

## Quality Criteria
✅ Product pages have Product schema with offers  
✅ Organization schema present on all pages  
✅ No errors in Rich Results test  
✅ BreadcrumbList on product/collection pages  
✅ FAQ schema on pages with FAQ content  
✅ Review schema if reviews are displayed  

---

## Common Mistakes to Avoid
❌ Invalid JSON syntax (missing commas, brackets)  
❌ Mismatched prices (schema price ≠ displayed price)  
❌ Wrong availability status  
❌ Missing required fields  
❌ Duplicate schema on same page  
❌ Not testing after changes  

---

## Schema Types Priority for E-commerce

| Schema Type | Priority | Benefit |
|-------------|----------|---------|
| Product | P0 | Price, availability, ratings in search |
| Organization | P1 | Knowledge panel, brand recognition |
| BreadcrumbList | P1 | Better navigation in search results |
| FAQPage | P2 | FAQ rich results, more SERP space |
| Review/Rating | P2 | Star ratings in search |
| LocalBusiness | P3 | Only if physical store |

---

## Shopify Apps for Schema (If Needed)
If your theme lacks good schema:
- JSON-LD for SEO (free version available)
- Smart SEO
- Schema Plus for SEO

**Note:** Many modern Shopify themes (Dawn, etc.) include good Product schema by default. Test before adding apps.

---

## Monitoring Schema
- [ ] Set up Google Search Console email alerts
- [ ] Check Search Console > Enhancements monthly
- [ ] Review "Product", "Breadcrumb", etc. sections
- [ ] Fix any new errors promptly
