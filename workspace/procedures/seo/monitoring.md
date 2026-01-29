---
version: "1.0"
created: "2026-01-29"
updated: "2026-01-29"
verified: "2026-01-29"
confidence: "high"
type: "procedure"
---

# SEO Monitoring & Maintenance Procedure

> **Verification Gate:** Before proceeding, state: "I have read the monitoring procedure. The three core metrics to track are: organic traffic, keyword rankings, and indexed pages."

## Purpose
Track SEO performance, identify issues early, and continuously improve.

## Prerequisites
- Google Search Console connected
- Google Analytics connected (or Shopify Analytics)
- Baseline metrics documented

## Tools/Resources
- **Google Search Console:** Indexing, clicks, rankings (FREE, essential)
- **Google Analytics / Shopify Analytics:** Traffic, conversions
- **PageSpeed Insights:** Performance checks
- **Rank tracking:** Google Search Console (free), or paid tools

---

## Step-by-Step Procedure

### Part 1: Initial Setup

#### Step 1: Verify Google Search Console
- [ ] Go to search.google.com/search-console
- [ ] Add property: dresslikemommy.com
- [ ] Verify ownership (Shopify makes this easy)
- [ ] Submit sitemap if not already done

#### Step 2: Connect Google Analytics (Optional but Recommended)
- [ ] Go to analytics.google.com
- [ ] Create GA4 property
- [ ] Add tracking code to Shopify:
  - Online Store > Preferences > Google Analytics
- [ ] Verify data is coming in

#### Step 3: Document Baseline Metrics
Before optimizing, record current state:
- [ ] Organic traffic (last 30 days)
- [ ] Number of indexed pages
- [ ] Top 10 keywords by clicks
- [ ] Average position for target keywords
- [ ] PageSpeed score (mobile + desktop)

---

### Part 2: Weekly Monitoring

#### Weekly Checklist (15-20 minutes)
- [ ] **Check Search Console overview**
  - Any sudden drops in clicks/impressions?
  - New pages indexed?
  - New errors?

- [ ] **Review top queries**
  - Go to Performance > Search results
  - Filter last 7 days
  - Note any keyword movement (up or down)

- [ ] **Check for critical errors**
  - Pages > Indexing
  - Any new "not indexed" errors?
  - Mobile Usability issues?

---

### Part 3: Monthly Monitoring

#### Monthly Checklist (1-2 hours)

##### Traffic Analysis
- [ ] Compare organic traffic: This month vs. last month
- [ ] Compare organic traffic: This month vs. same month last year (if available)
- [ ] Note top landing pages from organic search
- [ ] Identify declining pages (investigate why)

##### Keyword Performance
- [ ] Export top 100 keywords from Search Console
- [ ] Track target keywords for movement:
  - "mommy and me outfits"
  - "matching mother daughter dresses"
  - "mommy and me pajamas"
  - [Add your tracked keywords]
- [ ] Identify "striking distance" keywords (position 11-20)
- [ ] Create action plan to push striking distance keywords to page 1

##### Technical Health
- [ ] Run PageSpeed test on homepage, 1 product, 1 collection
- [ ] Check Core Web Vitals in Search Console
- [ ] Review any new crawl errors
- [ ] Check sitemap status

##### Content Performance
- [ ] Review blog post traffic
- [ ] Identify top-performing posts
- [ ] Identify underperforming posts (update or remove)
- [ ] Plan new content based on gaps

---

### Part 4: Quarterly Audit

#### Quarterly Deep Dive (Half day)

##### Full SEO Audit
- [ ] Re-run all technical SEO checks (see `technical.md`)
- [ ] Audit meta tags across site
- [ ] Review image alt text coverage
- [ ] Check for broken links

##### Competitor Analysis
- [ ] Check competitor rankings for target keywords
- [ ] Analyze competitor content (what are they publishing?)
- [ ] Review competitor backlinks (any new sources?)

##### Strategy Review
- [ ] Are we hitting traffic goals?
- [ ] Which tactics are working best?
- [ ] What should we do more of?
- [ ] What should we stop doing?
- [ ] Update keyword map if needed
- [ ] Update content calendar

---

### Part 5: What to Track

#### Key Metrics Dashboard

| Metric | Where to Find | Target | Frequency |
|--------|---------------|--------|-----------|
| Organic traffic | GA4/Shopify Analytics | Month-over-month growth | Weekly |
| Organic clicks | Search Console | Month-over-month growth | Weekly |
| Impressions | Search Console | Growing trend | Weekly |
| Average position | Search Console | Improving for targets | Monthly |
| Indexed pages | Search Console > Pages | All important pages | Monthly |
| Core Web Vitals | Search Console | Green (good) | Monthly |
| Backlinks | Ahrefs/Ubersuggest | Steady growth | Monthly |
| PageSpeed (Mobile) | PageSpeed Insights | 70+ | Monthly |

#### Target Keyword Tracking

Create a simple tracking spreadsheet:

| Keyword | Target Page | Jan Rank | Feb Rank | Mar Rank | Trend |
|---------|-------------|----------|----------|----------|-------|
| mommy and me outfits | /collections/all | 45 | 38 | 32 | ↑ |
| valentine mommy and me | /collections/valentines | - | 25 | 18 | ↑ |
| ... | ... | ... | ... | ... | ... |

---

### Part 6: Common Issues & Fixes

| Issue | How to Find | Fix |
|-------|-------------|-----|
| Traffic drop | Analytics | Check Google updates, technical issues, competitor moves |
| Pages not indexing | Search Console > Pages | Add internal links, improve content, request indexing |
| Slow page speed | PageSpeed Insights | Compress images, remove apps, optimize theme |
| Keyword rank drop | Search Console | Update content, add backlinks, check competitor |
| Crawl errors | Search Console | Fix broken links, check redirects |
| Mobile issues | Search Console > Mobile | Fix responsive design issues |

---

### Part 7: Reporting

#### Monthly SEO Report Template

```markdown
# SEO Report - [Month Year]

## Summary
- Organic traffic: [X] sessions ([+/-X%] vs last month)
- Organic clicks: [X] ([+/-X%] vs last month)
- New pages indexed: [X]

## Top Performing Keywords
1. [keyword] - [position] - [clicks]
2. [keyword] - [position] - [clicks]
3. [keyword] - [position] - [clicks]

## Keyword Wins (Improvements)
- [keyword]: Moved from position X to Y

## Keyword Losses (Need Attention)
- [keyword]: Dropped from position X to Y

## Technical Issues
- [Any errors and their status]

## Actions Taken This Month
- [What was optimized]

## Next Month Priorities
- [What to focus on]
```

---

## Quality Criteria
✅ Weekly Search Console checks completed  
✅ Monthly metrics documented and compared  
✅ Keyword tracking spreadsheet maintained  
✅ Quarterly audits scheduled and completed  
✅ Issues identified and action plans created  

---

## Common Mistakes to Avoid
❌ Not checking Search Console regularly  
❌ Only tracking vanity metrics (impressions without clicks)  
❌ Ignoring gradual declines until too late  
❌ Not documenting baseline metrics  
❌ Expecting instant results (SEO takes months)  
❌ Making changes without tracking impact  

---

## Search Console Navigation

**Performance:**
- Search results: Clicks, impressions, CTR, position
- Discover: If your content appears in Google Discover

**Indexing:**
- Pages: What's indexed, what's not, why
- Sitemaps: Sitemap status

**Experience:**
- Page experience: Core Web Vitals summary
- Mobile usability: Mobile-specific issues

**Enhancements:**
- Product snippets: Rich results for products
- Breadcrumbs: Breadcrumb schema status
- Sitelinks searchbox: If eligible
