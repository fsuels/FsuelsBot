# Task Backlog
*Auto-scored by TPS = (Revenue Impact × Confidence) ÷ (Human Minutes × Reversibility Risk)*
*Updated by: nightly compound loop, curiosity engine, manual additions*

## Active Tasks

### Valentine's Day Campaign (URGENT — Feb 14)
| Task | Persona | Revenue Impact | Confidence | Human Min | Risk | TPS | Status |
|------|---------|---------------|------------|-----------|------|-----|--------|
| Create Valentine's Day collection page | Catalog | 8 | 0.8 | 5 | 1 | 1.28 | pending |
| Write 10 V-Day product descriptions | Catalog | 7 | 0.7 | 10 | 1 | 0.49 | pending |
| Research V-Day competitor strategies | Traffic | 6 | 0.9 | 3 | 1 | 1.80 | pending |
| Draft V-Day email campaign | Conversion | 7 | 0.6 | 5 | 2 | 0.42 | pending |
| V-Day SEO keyword optimization | Traffic | 6 | 0.7 | 5 | 1 | 0.84 | pending |

### GMC Reinstatement (CRITICAL — Distribution Blocked)
| Task | Persona | Revenue Impact | Confidence | Human Min | Risk | TPS | Status |
|------|---------|---------------|------------|-----------|------|-----|--------|
| Audit GMC suspension requirements | Traffic | 10 | 0.8 | 10 | 1 | 0.80 | pending |
| Fix product data feed issues | Catalog | 10 | 0.6 | 15 | 2 | 0.20 | pending |
| Research GMC reinstatement best practices | Traffic | 9 | 0.9 | 3 | 1 | 2.70 | pending |

### Store Optimization (Ongoing)
| Task | Persona | Revenue Impact | Confidence | Human Min | Risk | TPS | Status |
|------|---------|---------------|------------|-----------|------|-----|--------|
| Audit top 10 product SEO tags | Traffic | 5 | 0.8 | 5 | 1 | 0.80 | pending |
| Fix ScamAdviser trust score | Traffic | 7 | 0.5 | 10 | 2 | 0.18 | pending |
| Product description template | Catalog | 6 | 0.9 | 3 | 1 | 1.80 | pending |
| Conversion audit of top 5 PDPs | Conversion | 6 | 0.7 | 5 | 1 | 0.84 | pending |

---

## Curiosity Engine Proposals (2026-01-29 9:00 PM)

### Proposal 1: Mobile LCP Emergency — 12.2s → <2.5s
- **Discovery:** Today's audit (3 AM session) revealed LCP of 12.2 seconds — nearly 5x the "Poor" threshold. Already documented in `knowledge/mobile-speed-optimization.md`.
- **Why it matters:** Core Web Vitals directly impact SEO rankings. 53% of users abandon sites loading >3s. This is actively killing conversions.
- **Suggested task:** Image compression audit + hero banner resize. Shopify Files audit for >500KB images, TinyIMG free tier, max hero at 1200px/200KB.
- **TPS estimate:** Revenue Impact 8 × Confidence 0.85 ÷ Human Min 5 ÷ Risk 1 = **1.36**
- **Persona:** Traffic (technical SEO)

### Proposal 2: Valentine Draft Products — Delete or Source Decision
- **Discovery:** 6 Valentine draft products exist in Shopify but have 0 stock because NO BuckyDrop sources are linked. They CANNOT SELL. Only 1 of 7 Valentine products (Red Heart Sweatshirt) is fully operational.
- **Why it matters:** Feb 10 deadline = 12 days. Dead weight drafts clutter store. Either source them via BuckyDrop request form OR delete to clean up.
- **Suggested task:** Submit BuckyDrop sourcing request for top 3 Valentine products (using their inquiry form), delete remaining 3 unsourceable drafts.
- **TPS estimate:** Revenue Impact 7 × Confidence 0.6 ÷ Human Min 8 ÷ Risk 1.5 = **0.35** (but deadline-urgent)
- **Persona:** Catalog
- **Note:** REQUIRES human action (Francisco login) — may need to move to human lane

### Proposal 3: Pinterest Merchant Status Check (48hr Window Passed)
- **Discovery:** Pinterest merchant review submitted Jan 27 at 2:05 PM. Now 72+ hours passed. Status completely unknown — could be approved, rejected, or pending.
- **Why it matters:** Maps to Level 2 (Unblock Distribution). Pinterest is free organic shopping channel. Previous rejection was broken links — now fixed with redirects.
- **Suggested task:** Log into Pinterest Business Hub, check merchant status, document result. If rejected, extract new rejection reasons for next attempt.
- **TPS estimate:** Revenue Impact 6 × Confidence 0.7 ÷ Human Min 2 ÷ Risk 1 = **2.1** (unchanged from Jan 28)
- **Persona:** Traffic
- **Note:** Already in backlog from Jan 28 — BUMPING PRIORITY due to time elapsed

---

## Curiosity Engine Proposals (2026-01-28 9:00 PM)

### Proposal 1: Resume Locale Redirect Batch
- **Discovery:** Redirect batch interrupted at ~2,047 of 5,226 (Jan 27). ~3,179 redirects still missing.
- **Why it matters:** Maps to **Level 2: Unblock distribution** — 404 errors hurt SEO and contributed to previous GMC/Pinterest rejections. Each missing redirect = lost link equity.
- **Suggested task:** Resume redirect batch via Shopify Admin API. Fully automated, 0 human minutes.
- **TPS estimate:** Revenue Impact 7 × Confidence 0.9 ÷ Human Min 1 ÷ Risk 1 = **6.3**
- **Persona:** Traffic

### Proposal 2: Create Valentine's Day Collection Page
- **Discovery:** 12 validated Valentine products researched (Jan 28), 10 blog posts published — but NO dedicated collection page exists. Feb 14 = 17 days.
- **Why it matters:** Maps to **Priority 2: Valentine's Day** — seasonal revenue window closing. Collection page enables: internal linking from blog posts, GMC product grouping, landing page for any future ads.
- **Suggested task:** Create "Valentine's Day" collection in Shopify, add relevant products, optimize title/description for SEO.
- **TPS estimate:** Revenue Impact 8 × Confidence 0.85 ÷ Human Min 3 ÷ Risk 1 = **2.27**
- **Persona:** Catalog

### Proposal 3: Check Pinterest Merchant Approval Status
- **Discovery:** Pinterest merchant review submitted Jan 27 at 2:05 PM. 48-hour window has passed. Status unknown.
- **Why it matters:** Maps to **Level 2: Unblock distribution** — Pinterest is a free organic channel. Previous rejection was due to broken links (now mostly fixed with redirects). If approved, products can appear in Pinterest Shopping.
- **Suggested task:** Log into Pinterest Business Hub, check merchant status, document result. If rejected, extract new rejection reasons.
- **TPS estimate:** Revenue Impact 6 × Confidence 0.7 ÷ Human Min 2 ÷ Risk 1 = **2.1**
- **Persona:** Traffic

## Completed Tasks
*(moved here after execution with score)*

## Deleted Tasks
*(moved here with reason — 5-step applied)*
