# Active Thread

*Last updated: 2026-01-29 21:15 EST*

## Current State: Mobile LCP Fix In Progress

**T032: Mobile LCP fix** - Francisco requested I implement the proper fix for lazy loading.

### The Problem:
- PageSpeed simulates Slow 4G → shows 6.9s LCP
- Root cause: Hero product images have `loading="lazy"` (1.25s delay)
- Real-user LCP is 2401ms ("Good") - not urgent but worth fixing

### The Fix:
Edit `sections/featured-collection.liquid` to pass `lazy_load: false` for first 2 products.

**Find this code:**
```liquid
{% for product in collection.products limit: section.settings.products_to_show %}
  {% render 'card-product',
    card_product: product,
```

**Change to:**
```liquid
{% for product in collection.products limit: section.settings.products_to_show %}
  {% assign lazy = true %}
  {% if forloop.first or forloop.index == 2 %}
    {% assign lazy = false %}
  {% endif %}
  {% render 'card-product',
    card_product: product,
    lazy_load: lazy,
```

### Current Blocker:
- Browser automation timing out (screenshots work, actions don't)
- Francisco doing manual edit with my guidance
- He's at the Shopify code editor now
- Next: Press Ctrl+P, type "featured-collection", make the edit

## Background Tasks Still Open:
- **T004 Valentine listings** - BLOCKED on BuckyDrop login (6 drafts need sourcing)
- **T021 Mission Control button** - In queue

## Quick Recovery:
If context truncated:
1. Read this file
2. LCP fix is simple 4-line edit to featured-collection.liquid
3. Francisco is at the code editor doing it manually
4. After LCP fix, return to T004 Valentine (needs BuckyDrop login)
