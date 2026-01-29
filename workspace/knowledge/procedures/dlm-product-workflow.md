---
version: "1.0"
created: "2026-01-28"
updated: "2026-01-28"
verified: "2026-01-28"
confidence: "medium"
---

# DLM Product Sourcing & Fulfillment Workflow
**Source:** Francisco's verbal walkthrough, 2026-01-28
**Status:** Active procedure — this is how the business operates

---

## Overall Goal
Increase profits by selling more, with competitive pricing and 30-50% margins after ALL costs.

## Step-by-Step Workflow

### 1. Product Discovery (1688.com)
- Keyword searches on 1688.com for fresh, trending mommy-and-me products
- Evaluate: Is the product fresh? Does it sell well? Is the vendor reliable? Does vendor allow dropshipping?
- Look for products that match the DLM brand aesthetic

### 2. Cost Calculation & BuckyDrop Import
- Copy the 1688 product link → paste into BuckyDrop
- BuckyDrop calculates:
  - Domestic shipping (within China)
  - BuckyDrop handling/service fees
  - International shipping to customer
  - Any customs/duties
- **Total cost** = product price + domestic shipping + handling + international shipping + customs

### 3. Pricing Strategy
- Target: **30-50% profit margin** AFTER total cost
- Must also be **competitively priced** vs other mommy-and-me stores
- Factor in future advertising spend when setting margins
- Sweet spot: $18-38 retail (from competitor research)

### 4. Product Listing Optimization (CRITICAL)
After BuckyDrop uploads to Shopify, Francisco manually edits:

#### Title
- SEO-optimized, clear, appealing
- Under 70 characters for search

#### Description
- Completely rewritten from supplier copy
- English-native, brand-appropriate
- Highlight matching aspect (mommy & me)

#### Images
- Use vendor's product photos as base
- **OPTIMIZE the images**
- **CHANGE THE FACES** — swap Chinese model faces to faces matching DLM brand
- Francisco has specific face templates he uses consistently
- This is a key brand differentiator

### 5. Size Conversion System
- Each factory has different sizing (Chinese sizes ≠ US sizes)
- For EVERY product, get the factory's size chart/dimensions
- AI generates an HTML size conversion table
- A **JavaScript size conversion script** is installed on the store
- When customer selects a size → script shows the converted dimensions at the bottom
- **CURRENTLY BROKEN** — needs audit and fixing for all products
- Each product needs its own size data since factories vary

### 6. Inventory & Vendor Monitoring (PAIN POINT)
Francisco's biggest operational problem — he couldn't keep up alone:
- 1688 vendors frequently **remove, change, or discontinue** products
- BuckyDrop connection to 1688 can break if vendor changes listing
- No automated monitoring was in place
- **When a sale happens for a dead product:**
  1. First: Image search on 1688 for another vendor selling the same product
  2. Last resort: Cancel the order
- **NEED:** Proactive automated monitoring of product availability

### 7. Fulfillment Flow
1. Customer orders on dresslikemommy.com
2. Order goes to BuckyDrop
3. BuckyDrop sources from connected 1688 vendor
4. Ships from China → customer
5. Target delivery: **8-15 days**

---

## Known Problems to Solve
1. **Size conversion script broken** — needs audit across all products
2. **No inventory monitoring** — products go stale/unavailable without notice
3. **Face swapping is manual** — explore AI automation
4. **Catalog freshness** — wasn't being updated regularly
5. **BuckyDrop reauthorization needed** — Shopify API changes broke connection

## Improvement Opportunities (Beyond Current Workflow)
- [ ] Automate 1688 product availability monitoring
- [ ] AI-powered face swapping (consistent brand faces)
- [ ] Automated size chart generation from factory specs
- [ ] Competitive price monitoring
- [ ] Seasonal collection rotation system
- [ ] Product performance tracking (retire non-sellers faster)
- [ ] Council consultation on optimal strategy

---
*Last updated: 2026-01-28*
