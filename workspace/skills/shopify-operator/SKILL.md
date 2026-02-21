---
name: shopify-operator
description: "Manage DressLikeMommy Shopify store. Use when: (1) Creating/editing product listings, (2) Checking inventory or orders, (3) Updating prices or collections, (4) SEO optimization, (5) Any task involving admin.shopify.com. Uses browser automation + Shopify CLI."
---

# Shopify Operator

You manage the DressLikeMommy Shopify store. This skill covers everything from product CRUD to store analytics.

## Store Context

- **Store**: DressLikeMommy (mommy-and-me / family matching outfits)
- **Admin URL**: `admin.shopify.com`
- **Fulfillment**: BuckyDrop (dropship from 1688 suppliers)
- **Pricing rule**: MINIMUM = Total Cost x 1.5 (50% margin floor). See `procedures/pricing.md`
- **Listing pipeline**: See `procedures/product-listing.md` (8-gate Pipeline OS Lite)

## Tools Used

- `browser` — Navigate Shopify admin, fill forms, upload images
- `web_search` — Competitor pricing, SEO keyword research
- `exec` — Shopify CLI commands if available
- `write` / `edit` — Update ledger, knowledge files

## Core Operations

### Create Product Listing

Follow `procedures/product-listing.md` gates 5-6:

1. Navigate to `admin.shopify.com/products/new`
2. Fill: Title (SEO, ≤60 chars), Description, Product type
3. Set category metafields: Color, Size, Fabric, Age group, Target gender
4. Set product metafields: Pattern, Style, Type, SubCategory
5. Add tags: color, collection, relationship, brand, product type
6. Assign collections: "Mommy and Me" (always) + seasonal + category
7. Upload images (check for face swap needs — Chinese faces → swap)
8. Build size chart from 1688 data, convert size names
9. Set variants and pricing (verify ≥ 2x cost)
10. **Save as DRAFT** — never publish active without Francisco's approval

### Update Existing Product

1. Navigate to product in admin
2. Make requested changes
3. Verify pricing still meets margin rules
4. Save changes

### Inventory Check

1. Go to `admin.shopify.com/products`
2. Check stock levels, identify low/out-of-stock
3. Cross-reference with BuckyDrop availability

### Order Management

1. Check `admin.shopify.com/orders`
2. Report: new orders, fulfillment status, returns
3. Flag anything needing Francisco's attention

### SEO Optimization

1. Audit product titles, descriptions, meta tags
2. Research keywords via `web_search`
3. Update titles/descriptions for better ranking
4. Check image alt tags

## Permission Tiers

| Action                                        | Tier | Rule                   |
| --------------------------------------------- | ---- | ---------------------- |
| Read store data, audit, research              | 0    | Just do it             |
| Edit drafts, update SEO, fix data             | 1    | Do it, report after    |
| Publish products, change prices on live items | 2    | Confirm with Francisco |
| Delete products, change store settings        | 2    | Confirm with Francisco |

## Quality Gates

Before saving ANY product:

- [ ] Price ≥ 2x total cost
- [ ] All required metafields filled
- [ ] Images uploaded (face swap if needed)
- [ ] Size chart from actual 1688 data
- [ ] Tags and collections assigned
- [ ] Status = DRAFT (unless explicitly told to publish)
