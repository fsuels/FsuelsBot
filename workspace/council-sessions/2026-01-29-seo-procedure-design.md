# Council Session: E-commerce SEO Procedure Design
**Date:** 2026-01-29
**Topic:** Standardized SEO Procedure for AI Agent Managing Shopify Store
**Participants:** Grok (X/xAI), ChatGPT 5.2 (OpenAI), Gemini 2.5 Pro (Google)

---

## Question Posed to the Council

> I need to create a STANDARDIZED SEO PROCEDURE for an AI agent managing a Shopify e-commerce store (mommy & me matching outfits). The goal: when the owner says 'fix all SEO on the website', the AI can work systematically in batches without missing anything.
>
> Key requirements:
> 1. Must be repeatable and consistent every time
> 2. Must work in batches (not try to do everything at once)
> 3. Must have clear checkpoints and verification gates
> 4. Must prioritize tasks by impact (what to fix first)
> 5. Must be Shopify-specific
> 6. Must cover: technical SEO, on-page SEO, product pages, collection pages, images, content, schema markup
>
> Questions for debate:
> - What's the optimal batch size and order?
> - How should the AI verify each fix was done correctly?
> - What's the minimum checklist that covers 80% of SEO value?
> - How often should the full procedure run?
> - What tools/apps should be used for monitoring?
> - How to handle the tension between speed and thoroughness?

---

## Round A: Initial Positions

### GROK (Grok 4.1 via X)

**Structure:** 5 Main Phases executed sequentially in batches

**Phase 1: Preparation and Audit (One-Time Setup per Run, No Batches Needed)**
- Purpose: Assess current state, identify issues, prioritize fixes
- Batch Processing: Initial site-wide audit using Shopify Analytics + GSC
- Checkpoint/Verification: Run initial audit, compare to previous audits, set baseline

**Phase 2: Technical SEO Fixes (Batch 1-2 Cycles, High Priority)**
- Coverage: Site speed, mobile-friendliness, canonical tags, SSL, sitemap, robots.txt
- Batch Size: 10-20 items (e.g., fix 10 slow-loading pages)
- Checkpoint: Before/after site speed tests, validate sitemap submissions
- Tools: Shopify SEO Manager or SEO King, Google PageSpeed Insights

**Phase 3: On-Page SEO Fixes (Batch 1-3 Cycles, Medium-High Priority)**
- Coverage: Title tags, meta descriptions, H1s, canonical URLs, HTTPS, internal links
- Batch Size: 10-20 items per batch (split into product/collection batches)
- Checkpoint: Verify via Shopify Admin, crawl sample URLs
- Tools: Shopify's bulk editor, SEO Checker apps

**Phase 4: Images and Content Optimization (Batch 3+ Cycles, Medium Priority)**
- Coverage: Alt text, image compression, collection pages, content gaps, schema markup
- Batch Size: Start with 200+ products prioritized by traffic
- Checkpoint: Random sample of 20 images, Rich Results Test
- Impact: ~10% of SEO value (improve user experience and image search traffic)

**Phase 5: Schema Markup and Final Review (Batch 6+ Cycles, Low-Medium Priority)**
- Coverage: Structured data (Site, Store, Products), JSON-LD validation
- Batch Size: Focus on key pages (homepage, top collections, top products)
- Tools: Google Structured Data Testing Tool, schema apps

**Addressing Debate Questions:**

1. **Optimal Batch Size and Order:**
   - 10-15 items optimal for balance
   - Order: Technical → On-Page → Content/Images → Schema
   - Prioritize high-traffic items first

2. **Verification Methods:**
   - Automated: Use GSC performance stats, API endpoints, Shopify preview
   - Manual: Spot-check via browser, Rich Results Test, sample crawls
   - Define "good enough" thresholds (e.g., speed <3s, pass mobile-friendly)

3. **80/20 Minimum Checklist:**
   - Site speed >60 (PageSpeed)
   - Mobile-friendly (Google test)
   - Unique, keyword-rich titles on all products
   - Clean URLs without duplicates
   - Alt text on all images
   - Schema validation
   - Sitemap submitted
   - Strong internal linking

4. **Frequency:**
   - Full procedure: Weekly (or per-product-added for new listings)
   - Monthly: Major site-wide audits
   - Rationale: Balance thoroughness with operational efficiency

5. **Tools/Apps:**
   - Shopify Native: Analytics, Search Console integration
   - Apps: SEO Manager or SEO King (free tiers), TinyIMG
   - External: Google Search Console, Structured Data Testing Tool

6. **Speed vs Thoroughness:**
   - Two-pass approach: Pass 1 for speed/impact, Pass 2 for thoroughness
   - Start thorough and optimize for speed based on results

---

### CHATGPT (ChatGPT 5.2)

**Structure:** 7 Phases (0-7) with specific batch sizes per phase

**Operating Principles (AI must obey every run):**
1. Start with measurement + crawlability
2. Fix once at template/system level before page-by-page edits
3. Work in impact-ranked batches with explicit gates
4. Every change has a verification step
5. Stop conditions per batch: if gate fails, revert/repair before proceeding

**Phase 0 — Setup & Baseline (Run once, then monthly review)**
- Goal: Ensure store can be crawled, measured, and audited
- Tasks: Connect GSC, confirm ownership, submit sitemap.xml, ensure no password protection, record baseline KPIs
- Verification Gates: GSC property verified, sitemap submitted
- Artifacts: SEO_RUN_LOG, SEO_BASELINE_SNAPSHOT

**Phase 1 — Technical SEO Foundation (Batch 1: highest impact)**
- Goal: Remove crawl/indexation blockers before touching copy
- Batch Size: 1 batch (all technical items together - interdependent)
- Tasks: Indexation & duplicates, sitemap & robots, Core Web Vitals/speed, redirects & broken links, structured data baseline
- Verification Gates: GSC "Not indexed" trending down, Rich Results eligible, PageSpeed scores improve, no regressions on add-to-cart/checkout

**Phase 2 — Template-Level On-Page SEO (Batch 2: highest leverage content)**
- Goal: Fix what repeats across hundreds of URLs
- Batch Size: 5-10 templates max per batch (Product, Collection, Blog, Page, Home)
- Tasks: Title tag rules, meta description rules, heading hierarchy, internal linking blocks, Open Graph/social
- Verification Gates: Sample 10 URLs per template, no duplicate title patterns

**Phase 3 — Revenue-Weighted Product SEO (Batch 3: rankings + conversions)**
- Goal: Optimize products that matter first
- Batch Size: **25 products per batch**
- Order: Top revenue → Top organic landing → Highest margin → New arrivals
- Checklist per product: Primary keyword in title/description/H2, variant clarity, description structure, image alt text, media optimization
- Verification Gates: Shopify Admin check, spot-check 5 URLs in Rich Results test

**Phase 4 — Collection SEO (Batch 4: category pages drive most SEO)**
- Goal: Make collections rank (higher-volume terms)
- Batch Size: **10 collections per batch**
- Checklist: Title aligned to intent, 150-300 words unique intro copy, optional FAQ accordion, internal links to 2-5 sibling collections
- Verification Gates: Crawl sample for unique titles/metas, GSC collection queries

**Phase 5 — Images at Scale (Batch 5: fast wins)**
- Goal: Speed + image search + accessibility
- Batch Size: **100 images per batch**
- Priority: Hero images → Product images for top products → Collection banners
- Verification Gates: Random sample of 20 images (size reduced, quality acceptable, alt present), PageSpeed LCP improvements

**Phase 6 — Schema Markup (Batch 6: rich results + disambiguation)**
- Goal: Ensure Google understands products, breadcrumbs, organization, FAQs
- Approach: Pick one source of truth (theme schema OR dedicated app)
- Minimum coverage: Product, BreadcrumbList, Organization/WebSite, Article for blogs
- Verification Gates: Rich Results test no critical errors, no duplicate schema blocks

**Phase 7 — Content & Authority (Batch 7: ongoing)**
- Goal: Capture informational intent that feeds product rankings
- Batch Size: **2-4 content pieces per month**
- Content themes: Sizing guide, family photo outfit ideas, matching outfits by season, care guides
- Verification Gates: Each article links to products/collections, has FAQ section, indexed in GSC

**Answers to Debate Questions:**

1. **Optimal Batch Size and Order:**
   - Technical foundation (single batch)
   - Template-level on-page (by template)
   - Top products (25 per batch)
   - Collections (10 per batch)
   - Images (100 per batch)
   - Schema (single controlled batch)
   - Content (monthly cadence)
   - Rationale: Shopify is template-driven; fixing templates first yields biggest sitewide lift

2. **Two-Layer Verification:**
   - Layer A — Shopify confirmation: field values saved, theme changes published
   - Layer B — External confirmation: GSC, Rich Results test, PageSpeed
   - Every batch ends with: "Batch QA sample" (10 URLs), log outcomes + regressions

3. **80/20 Minimum Checklist:**
   - GSC verified + sitemap submitted
   - No accidental noindex/password protection
   - Clean titles/H1s/metas on product + collection templates
   - Unique, helpful copy on top collections
   - Image compression + alt text on top landing pages
   - Fix 404s + implement redirects
   - Valid Product schema (no critical errors)

4. **Frequency:**
   - Daily (lightweight): GSC check for errors, manual actions, indexing drops
   - Weekly (operational): One batch from Phase 3-5, plus 404 review
   - Per product added: Product checklist + image alt + collection assignment + schema
   - Monthly (maintenance): Technical re-audit, speed regression check, schema validation

5. **Tools/Apps:**
   - Core: Google Search Console
   - Shopify ecosystem: Plug In SEO, TinyIMG, Avada, Booster, Tapita, Schema/JSON-LD apps
   - Advanced: Screaming Frog, Ahrefs/SEMrush

6. **Speed vs Thoroughness — Two-Pass Policy:**
   - Pass 1 (speed/impact): Fix templates + top products + top collections first
   - Pass 2 (thoroughness): Expand coverage to full catalog and long-tail
   - **Hard rule: Never skip verification gates. If you need speed, reduce batch size, not QA.**

**"Fix all SEO" Execution Template:**
1. Read baseline dashboards (GSC + speed sample)
2. Pick next batch by priority queue
3. Apply changes
4. Run verification gates
5. Log results + mark batch complete
6. Move to next batch

---

### GEMINI (Gemini 2.5 Pro via CLI)

**Structure:** SOP (Standard Operating Procedure) format with time-based cadence

**1.0 Objective**
Systematically improve organic search visibility, traffic, and revenue for Shopify store specializing in "mommy and me outfits."

**2.0 Key Performance Indicators (KPIs)**
- **Primary:** Organic Traffic, Organic Revenue, Keyword Rankings
- **Secondary:** CTR, Avg Transaction Value, Indexed Pages, Core Web Vitals

**3.0 Core Principles (The 80/20 Checklist) — 8 Points**
1. **Keyword & Intent Alignment:** Page title, H1, content match user search query
2. **Title Tag Optimization:** Primary keyword at beginning, <60 chars, compelling element
3. **Meta Description:** Accurate, includes keyword + CTA, <160 chars
4. **Content Quality & Uniqueness:** Unique descriptions, helpful, 300-500 words for collections
5. **Image SEO:** High-quality, descriptive ALT text with keyword
6. **Internal Linking:** Pages receive and give relevant links
7. **URL Structure:** Clean, short, contains primary keyword
8. **Mobile-First & Page Speed:** Fully functional, fast on mobile

**4.0 Required Monitoring Tools**
- Google Search Console (GSC) API
- Google Analytics 4 (GA4) API
- SEO Suite API (Ahrefs, SEMrush)
- Internal Site Crawler (Screaming Frog CLI or Python scraper)

**5.0 SEO Execution Cadence**

**5.1 Daily Tasks (Monitoring & Alerting)**
- Query GSC API for crawl errors, manual actions, security issues
- Check internal crawler logs for 404 spikes (>10 new)
- Monitor top 5 commercial keywords (>5 position drop = critical alert)
- Verification Gate: GSC "green," no critical drops. Alert = halt other tasks.

**5.2 Weekly Tasks (Technical & Opportunity Analysis)**
- Execute full site crawl
- Identify technical issues (broken links, redirect chains, missing titles, duplicates)
- Query GSC for "high impressions, low CTR" and "page 2 rankings"
- Identify 5-10 "striking distance" pages for monthly optimization
- Batch Size: Top 20 most critical technical errors
- Verification Gate: Prioritized target page list generated

**5.3 Monthly Tasks (On-Page Optimization & Content)**
- Select batch based on Weekly analysis
- Apply full 80/20 Checklist to each page
- Implement: Title tags, meta descriptions, H1s, image ALT, description rewrites
- Add 2-3 new internal links per page
- Submit URLs to Google Indexing API
- **Batch Size: 15 Product Pages + 5 Collection Pages**
- Verification Gate: Post-optimization crawl, monitor CTR/position over 4-6 weeks

**5.4 As-Needed Tasks (New Product/Collection Launch)**
- Pre-Launch: Keyword research
- Staging: Apply ENTIRE 80/20 Checklist before publishing (non-negotiable)
- Launch: Publish, submit to Indexing API, build 3-5 internal links
- Verification Gate: URL indexed within 48 hours, passes live SEO audit

---

## Points of Agreement (All Three AIs)

| Topic | Consensus |
|-------|-----------|
| **Priority Order** | Technical SEO first (foundation), then templates/on-page, then content |
| **Verification Required** | All emphasize verification gates after each batch |
| **GSC is Core** | Google Search Console is non-negotiable monitoring tool |
| **Template-First** | Fix at template level before individual pages (highest leverage) |
| **80/20 Focus** | All provide some form of "essential checklist" for maximum impact |
| **Batch Processing** | All agree on batched approach vs. all-at-once |
| **Speed vs Quality** | Never skip verification; reduce batch size instead |
| **Image ALT Text** | All include as high-impact, often-missed item |
| **Internal Linking** | Consistently mentioned as underutilized SEO lever |

## Points of Disagreement

| Topic | Grok | ChatGPT | Gemini |
|-------|------|---------|--------|
| **Number of Phases** | 5 phases | 7 phases (more granular) | Time-based cadence (Daily/Weekly/Monthly) |
| **Product Batch Size** | 10-20 items | 25 products | 15 products/month |
| **Collection Batch Size** | 10-20 items | 10 collections | 5 collections/month |
| **Image Batch Size** | Not specified | 100 images | Not explicitly batched |
| **Full Audit Frequency** | Weekly | Monthly (with daily/weekly monitoring) | Monthly |
| **Schema Approach** | Separate phase | Separate phase | Integrated into checklist |

## Unique Insights by AI

### Grok's Unique Contributions:
- Emphasized **"striking distance" concept** early (pages ranking 11-20)
- Suggested **free tier apps** (SEO Manager, SEO King) for budget constraints
- Practical focus on **Shopify-native tools** integration

### ChatGPT's Unique Contributions:
- Most granular phase structure with **specific batch numbers per phase type**
- Introduced **"artifacts produced"** concept (SEO_RUN_LOG, SEO_BASELINE_SNAPSHOT)
- **Two-layer verification** (Shopify confirmation + External confirmation)
- **Title tag format templates**: `{Product Name} | Mommy & Me Matching Outfits | {Brand}`
- Emphasized **variant clarity** for Shopify (mommy/me as variants)
- **Content themes** specific to niche: sizing guides, family photo ideas, seasonal matching

### Gemini's Unique Contributions:
- **SOP (Standard Operating Procedure) format** with formal structure
- **KPIs defined upfront** before execution
- **Time-based cadence** (Daily/Weekly/Monthly) vs. phase-based
- **API-first approach** (GSC API, GA4 API, SEO Suite API)
- **48-hour indexation verification** for new pages
- **Alert-based priority shifts** (critical alert = halt other tasks)

---

## Synthesized Recommendation

Based on the council debate, here is the **optimal SEO procedure** combining the best elements:

### Structure: Hybrid Phase + Cadence Model

**Ongoing Cadence (Background):**
- **Daily:** GSC health check (alerts only)
- **Weekly:** Technical error review, opportunity analysis

**Batch Phases (Execute in Order):**
1. **Phase 0: Baseline** — GSC setup, sitemap, baseline KPIs (1x)
2. **Phase 1: Technical** — Speed, indexation, robots, redirects (1 batch)
3. **Phase 2: Templates** — Title/meta/H1 rules for all templates (5-10 templates)
4. **Phase 3: Products** — 20-25 products per batch, prioritized by revenue
5. **Phase 4: Collections** — 10 collections per batch with unique copy
6. **Phase 5: Images** — 100 images per batch, prioritized by traffic
7. **Phase 6: Schema** — Validate/implement structured data (1 batch)
8. **Phase 7: Content** — 2-4 pieces monthly (ongoing)

### 80/20 Checklist (7 Items)
1. ✅ GSC verified + sitemap submitted
2. ✅ No noindex/password protection on key pages
3. ✅ Clean titles/H1s/metas on product + collection templates
4. ✅ 150+ words unique copy on top collections
5. ✅ Image compression + descriptive ALT text
6. ✅ 404s fixed + redirects implemented
7. ✅ Valid Product schema (no critical errors)

### Verification Protocol
- **Layer A (Internal):** Shopify Admin confirms changes saved
- **Layer B (External):** GSC, Rich Results Test, PageSpeed
- **Every Batch:** QA sample of 10 URLs + log outcomes

### Speed vs Thoroughness Rule
> **Never skip verification gates. If you need speed, reduce batch size, not QA.**

---

## Session Metadata
- **Round A:** Complete (all 3 AIs responded)
- **Round B (Cross-Examination):** Partial (Gemini rate-limited)
- **Round C (Synthesis):** Completed via analysis
- **Total Duration:** ~45 minutes
- **Models Used:** Grok 4.1, ChatGPT 5.2, Gemini 2.5 Pro
