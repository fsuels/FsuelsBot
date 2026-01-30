---
version: "2.0"
created: "2026-01-29"
updated: "2026-01-29"
verified: "2026-01-29"
confidence: "high"
type: "procedure"
source: "council-sessions/2026-01-29-workflow-optimization-5round.md"
---

# 📦 Product Listing Procedure v2.0 — Pipeline OS Lite

**Read this COMPLETELY before ANY product listing or sourcing task.**

---

## ⚠️ HARD INVARIANTS (NON-NEGOTIABLE)

```
┌─────────────────────────────────────────────────────────────┐
│  🚫 SHOPIFY DRAFT CANNOT START UNTIL BUCKYDROP = DONE       │
│                                                             │
│  Before creating ANY Shopify draft, verify:                 │
│  1. BuckyDrop product exists with linked source             │
│  2. All costs extracted (product + domestic + intl + fees)  │
│  3. Weight recorded in ledger                               │
│  4. Gate status = "Done" in ledger                          │
│                                                             │
│  If ANY of these are missing → STOP. Complete BuckyDrop.    │
└─────────────────────────────────────────────────────────────┘
```

### 3 Non-Negotiable Rules

1. **No gate completion without evidence written to ledger**
2. **No waiting on blocked UI—convert to ticket, continue other work**
3. **No "memory"—always resume from ledger state**

---

## Verification Gate

**Before starting ANY listing work, state:**

> "Pipeline verified. Gate [N]: [name]. Ledger checked: [X] products at this gate. Session health: [OK/blocked]. Browser: [N] tabs. Ready to proceed."

If you cannot state this, STOP and run the pre-flight checklist.

---

## 🚪 THE 8 GATES

| Gate | Name | Type | Worker | Entry Criteria | Exit Artifact |
|------|------|------|--------|----------------|---------------|
| 0 | **Intake/Dedupe** | Fast, cohort | Main | Search term defined | Shopify duplicate check complete |
| 1 | **Discovery/Vet** | BATCH (3-5) | Sub-agents OK | No duplicates found | Vetted candidate URLs |
| 2 | **Candidate Freeze** | Fast, per-item | Main | Vendor verified | Facts locked in ledger |
| 3 | **BuckyDrop Import** | SEQUENTIAL | Main | Facts frozen | Full cost breakdown recorded |
| 4 | **Pricing** | Per-item | Main | BuckyDrop DONE | Price set with margin verified |
| 5 | **Shopify Draft** | Per-item | Sub-agent OK | BuckyDrop DONE + Price set | Draft created with all fields |
| 6 | **QA** | Per-item | Main | Draft exists | Checklist passed |
| 7 | **Closeout** | Fast, cohort | Main | QA passed | Ledger updated, tracking complete |

**CRITICAL:** Gate 5 has HARD DEPENDENCY on Gate 3. Check before proceeding.

---

## 📊 THE LEDGER (Tracking Spreadsheet)

### Required Columns

| Column | Type | Values | Purpose |
|--------|------|--------|---------|
| Product | Text | Product name | Identifier |
| 1688_URL | URL | Full 1688 link | Source reference |
| **Gate** | Enum | Intake, Vet, Freeze, BuckyDrop, Pricing, Draft, QA, Closeout | Current position |
| **Substep** | Text | e.g., BD_03_select_variant | Precise location |
| **Status** | Enum | Not started, In progress, Blocked, Done | State |
| LastCheckpoint | DateTime | Timestamp | Recovery point |
| EvidenceLinks | URLs | Screenshots, product URLs | Proof of completion |
| **HumanNeeded** | Y/N | Y or N | Handoff flag |
| **BlockerType** | Enum | Login, UI_load, Captcha, Missing_data, Policy | What's wrong |
| **ResumeInstruction** | Text | Exact next action | Recovery path |
| Weight_g | Number | Product weight in grams | For shipping calc |
| TotalCost | Currency | Full cost breakdown | Pricing input |
| Price | Currency | Final selling price | Output |
| Margin_pct | Percent | Calculated margin | Verification |
| Notes | Text | Free-form | Context |

### Checkpoint Protocol

**Write state every 1-3 minutes while working:**

```
current_gate: BuckyDrop
substep_id: BD_03_select_variant
artifact_links: [screenshot URL]
blocking_reason: null
next_action: Map adult sizes to variants
```

**On resume:** Bot reads ledger → continues from Gate/Substep → never relies on memory.

---

## 🔌 UI CONTRACTS

### BuckyDrop Import

```yaml
BuckyDrop_Dashboard:
  entry: URL "buckydrop.com" AND element "My Store Products" visible
  success: Dashboard loads with product list
  failure_modes: [session_expired, ui_not_loaded, maintenance_page]
  fallback: Navigate to buckydrop.com, click "My Store Products"
  stop: After 2 failures, Status=Blocked, BlockerType=Login, queue ticket

BuckyDrop_ImportURL:
  entry: On import page AND import field visible
  action: Paste 1688 URL into import field, click Search
  success: Product preview shows with variants and weight
  failure_modes: [url_rejected, no_results, timeout, captcha]
  fallback: Try "Find Similar Source" button instead
  stop: After 2 failures, escalate with screenshot

BuckyDrop_CostExtract:
  entry: Product imported, shipping config visible
  action: Select YunExpress route, USA destination, extract all costs
  success: Product cost + domestic + international + fees all visible
  failure_modes: [route_unavailable, weight_missing, price_not_loading]
  fallback: Try different shipping route, then escalate
  stop: If weight missing, cannot proceed - mark HumanNeeded=Y
```

### 1688 Navigation

```yaml
1688_Search:
  entry: URL "1688.com" AND search bar visible
  action: Enter search term in Chinese, click search
  success: Product grid loads with results
  failure_modes: [captcha, login_required, no_results]
  fallback: Use saved search URLs from previous sessions
  stop: If captcha, Status=Blocked, BlockerType=Captcha, queue ticket

1688_ProductPage:
  entry: On product detail page
  action: Extract: price, weight, size chart, vendor info
  success: All required fields visible and extractable
  failure_modes: [page_not_loading, sold_out, vendor_closed]
  fallback: Try alternative product from same search
  stop: Mark product as unavailable, move to next candidate
```

### Shopify Admin

```yaml
Shopify_NewProduct:
  entry: URL "admin.shopify.com/*/products/new"
  action: Fill product fields per checklist
  success: All required fields populated, save button enabled
  failure_modes: [session_expired, validation_error, image_upload_fail]
  fallback: Refresh page, re-authenticate if needed
  stop: After 2 failures, save progress and escalate

Shopify_Draft:
  entry: Product form complete
  action: Set status to "Draft", click Save
  success: Product saved, URL shows product ID
  failure_modes: [save_failed, validation_error]
  fallback: Fix validation errors shown, retry save
  stop: Screenshot errors, escalate to Francisco
```

---

## 🔄 SESSION HANDLING PROTOCOL

### At Cohort Start: Session Health Check

Before processing ANY products:

1. Open BuckyDrop dashboard
2. **Verify:** "My Store Products" element is visible
3. **If NOT visible:**
   - Status = Blocked
   - BlockerType = Login
   - HumanNeeded = Y
   - ResumeInstruction = "Login to BuckyDrop, then resume"
4. **If visible:** Proceed with cohort

### On Auth Failure (Mid-Task)

1. **Detect:** Redirect to login, missing element, 401 error
2. **Immediately write to ledger:**
   - Status = Blocked
   - BlockerType = Login
   - Substep = where you were
   - ResumeInstruction = exact next action
3. **Queue human ticket** with: BlockerType, Evidence (screenshot), Resume check
4. **Continue with OTHER work** that doesn't require that session
5. **TTL:** If human doesn't resolve in 2 hours, re-evaluate priorities

### Non-Blocking Pattern

```
IF session_blocked:
    write_checkpoint(current_state)
    queue_human_ticket(blocker_details)
    switch_to_unblocked_work()  # Other products, other gates
    DO NOT WAIT
```

---

## 📦 BATCH SIZE RULES

| Condition | Batch Size |
|-----------|------------|
| **Default** | 5 products |
| Uniform vendors, simple variants | Up to 8 |
| Messy size charts, many variants | 3-4 |
| BuckyDrop flaky today | 3-5 |
| First time with new process | 3 (safety) |

### Batchable Gates (Use Sub-Agents)

- **Gate 0 (Intake):** Fast, do full cohort at once
- **Gate 1 (Discovery/Vet):** BATCH 3-5 products in parallel
- **Gate 7 (Closeout):** Fast, do full cohort at once

### Sequential Gates (One Product at a Time)

- **Gate 2 (Freeze):** Quick, per product
- **Gate 3 (BuckyDrop):** MUST be sequential (hard dependency)
- **Gate 4 (Pricing):** Per product, depends on Gate 3
- **Gate 5 (Shopify Draft):** Per product, depends on Gate 3+4
- **Gate 6 (QA):** Per product

---

## 🤝 BOT-HUMAN HANDOFF

### Two-Lane System

**Bot Lane (default):** HumanNeeded=N AND Status≠Done
- Sorted by Gate priority (lower gates first)
- Bot works through these autonomously

**Human Lane:** HumanNeeded=Y OR Status=Blocked
- Francisco checks these when available
- Clear tickets with exact asks

### Human Ticket Requirements

Every ticket MUST include:

| Field | Description |
|-------|-------------|
| BlockerType | What category of problem |
| Exact Ask | One specific action needed |
| Evidence | Screenshot or URL showing the issue |
| Resume Check | What proves it's fixed (element visible, etc.) |
| TTL | When bot should re-evaluate if not resolved |

### Handoff Protocol

1. **Bot creates atomic ticket** → Writes to ledger + notifies Francisco
2. **Human resolves** → Flips HumanNeeded=N, updates Resume field
3. **Bot resumes** → Re-runs verification step first, doesn't proceed blindly

---

## Gate Details

### Gate 0: Intake/Dedupe (ALWAYS FIRST)

Before sourcing ANY new products:

1. **Define search criteria** — What are we looking for?
2. **Check Shopify inventory:**
   - Active products in relevant collections
   - Draft products in progress
   - **Don't duplicate what we already have!**
3. **Record in ledger:** Search term, existing count, target count

**Exit:** "Inventory check: [X] active products, [Y] drafts in queue. Looking for: [product type]. No duplicates for [search term]."

---

### Gate 1: Discovery/Vet (BATCHABLE)

**Batch 3-5 candidates at a time.**

#### 1.1 Vendor Quality Checks (CRITICAL)

Before selecting ANY product, verify the vendor:

- [ ] **Store rating** — 4.5+ stars preferred, never below 4.0
- [ ] **Transaction volume** — Active sales (shows recent orders)
- [ ] **Store age** — Established sellers (1+ years preferred)
- [ ] **Response rate** — High response = reliable communication
- [ ] **Product availability** — Check stock indicators
- [ ] **1-piece dropshipping** — Must allow single unit orders
- [ ] **Fast warehouse delivery** — 24-48hrs to BuckyDrop China warehouse

**Red flags (AVOID):**
- ❌ No recent sales/reviews
- ❌ Store opened recently with no history
- ❌ Poor ratings or many complaints
- ❌ "Sold out" or "discontinued" status
- ❌ **Old listings** — factories keep discontinued products as "hooks"

#### 1.2 Product Selection Criteria

**We sell: Mommy and me / family matching outfits**

Good products have:
- ✅ Multiple sizes — Adult AND child sizes in same listing
- ✅ Matching designs — Same fabric/pattern for both
- ✅ Good photos — Clear, professional images
- ✅ Market appeal — Seasonal or evergreen
- ✅ Reasonable base cost — Allows 50%+ margin

#### 1.3 Freshness Check

- Sort by "newest" or "recent sales"
- Check listing creation date — recent only
- Verify photos look current
- **Avoid old listings**

**Exit:** For each candidate: "Vendor [name]: [rating], [sales], 1-piece OK, 24-48hr delivery. Listing date: [date]. Product: [name], fits criteria."

---

### Gate 2: Candidate Freeze

For each vetted candidate:

1. **Lock facts in ledger:**
   - 1688 URL
   - Vendor name + rating
   - Base price (CNY)
   - Weight (if visible)
   - Available sizes
   - Notes on quality

2. **Confirm no changes** since vetting

**Exit:** "Candidate frozen: [product]. Facts locked. Ready for BuckyDrop import."

---

### Gate 3: BuckyDrop Import (SEQUENTIAL — HARD GATE)

**⚠️ This gate MUST complete before Gate 5 can start.**

1. **Session health check** — Verify logged in
2. Open BuckyDrop (use existing tab)
3. Import product using 1688 URL
4. **Extract from 1688 listing:**
   - Product weight (ADULT size)
   - Size chart table (all measurements)
   - Size names for conversion

5. **Configure:**
   - Shipping route: **YunExpress**
   - Destination: **USA** (use for all markets)
   - Variants: all sizes needed

6. **Get FULL cost breakdown:**
   - Product cost
   - Domestic shipping (China)
   - International shipping (to USA)
   - BuckyDrop fees
   - **TOTAL COST = sum of all**

7. **Write to ledger:**
   - Weight_g
   - TotalCost
   - Cost breakdown
   - Status = Done
   - EvidenceLinks (screenshot of cost page)

**Exit:** "BuckyDrop complete. Weight: [X]g. Total cost: $[Y] (product $[A] + domestic $[B] + intl $[C] + fees $[D]). Evidence recorded."

---

### Gate 4: Pricing

**Prerequisite check:** `IF Gate3_Status ≠ Done THEN STOP`

### The Formula (NON-NEGOTIABLE)

```
MINIMUM PRICE = TOTAL COST × 2

This ensures AT LEAST 50% profit margin AFTER:
- Ads cost buffer
- Returns cost buffer  
- Platform fees
```

### Competitor Check

1. Search Amazon, Etsy, Google Shopping for similar
2. Note competitor price range
3. **If competitors cheaper than 2× cost:**
   - Can we find cheaper source?
   - Is margin still acceptable?
   - FLAG to Francisco if margin < 40%
4. Price competitively within margin constraints

**Exit:** "Pricing set. Cost $[X] × 2 = $[Y] min. Competitors: $[A]-$[B]. Final: $[Z] ([M]% margin)."

---

### Gate 5: Shopify Draft (HARD DEPENDENCY ON GATE 3)

```
┌─────────────────────────────────────────────┐
│  ⛔ STOP CHECK BEFORE PROCEEDING            │
│                                             │
│  □ BuckyDrop Gate = Done?                   │
│  □ Weight recorded in ledger?               │
│  □ Total cost recorded in ledger?           │
│  □ Price calculated and recorded?           │
│                                             │
│  If ANY box unchecked → GO BACK TO GATE 3   │
└─────────────────────────────────────────────┘
```

#### 5.1 Basic Info
- Title: SEO-friendly (≤60 chars)
- Description: Benefits, materials, sizing
- Product type: Set appropriately

#### 5.2 Category & Metafields

**Category Metafields (for filters):**
- Color — exact filter values (Red, Pink, White, etc.)
- Size — all sizes in listing
- Fabric — material type
- Age group — Kids, Adults, All Ages
- Target gender — Female, Male, Unisex

**Product Metafields (for SEO):**
- Pattern, Style, Type
- SubCategory / SubCategory2
- Category1

#### 5.3 Tags

Required tags:
- Color tags
- Collection tags (valentines day, christmas, etc.)
- Relationship tags (mother daughter, matching family)
- Brand tags (Mommy and Me)
- Product type tags

#### 5.4 Collections

- Mommy and Me (always)
- New Mommy & Me (if new)
- Seasonal collection
- Category collections

#### 5.5 Images

- Upload all product images
- **Face check:** Chinese faces → need face swap
- Order: Main first, angles, size chart

#### 5.6 Face Swapping (if needed)

1. Download images
2. Go to: https://aifaceswap.io/#face-swap-playground
3. Use faces from: `C:\Users\Fsuels\Downloads\faces`
4. Swap to American-looking faces
5. Upload to Shopify

#### 5.7 Size Chart

1. Extract size table from 1688
2. Create table with actual measurements
3. Convert size names to standard:
   - Kids: 80cm-150cm
   - Adults: Adult S through 3XL
4. Apply size conversion script
5. Verify dynamic selector works

#### 5.8 Variants & Pricing

- Set up all size variants
- Apply calculated price
- Verify no variant below minimum

#### 5.9 Save as DRAFT

- **NEVER publish active**
- Save as DRAFT
- Record draft URL in ledger

**Exit:** "Draft created: [product]. Price: $[X]. Tags: [list]. Collections: [list]. Evidence: [draft URL]."

---

### Gate 6: QA

**Checklist (all must pass):**

- [ ] Title optimized (SEO-friendly, ≤60 chars)
- [ ] Description complete
- [ ] Category set correctly
- [ ] All metafields filled
- [ ] Tags added (all required categories)
- [ ] Collections assigned
- [ ] All images uploaded
- [ ] Face swap done (if needed)
- [ ] Size chart from 1688 data (not guessed)
- [ ] Size names converted
- [ ] Price ≥ 2× cost
- [ ] Saved as DRAFT
- [ ] Ledger updated with draft URL

**Exit:** "QA passed: [product]. All [N] checklist items verified."

---

### Gate 7: Closeout

For the cohort:

1. **Update ledger:** All products to status = Complete
2. **Browser cleanup:** Close unneeded tabs, keep ≤ 4
3. **Update tracking files:**
   - state.json → progress count
   - memory file → session log
4. **Summary report:**

```
Cohort complete: [N] products
- [Product 1]: $[price], [margin]%, draft URL
- [Product 2]: $[price], [margin]%, draft URL
...
Blocked: [list any blocked items]
Human queue: [list any pending tickets]
Ready for Francisco's review.
```

---

## Quick Reference

### Pre-Flight Checklist
- [ ] Read this procedure completely
- [ ] Check ledger for current state
- [ ] Session health check (BuckyDrop logged in?)
- [ ] Browser tabs checked (ONE per domain)
- [ ] Identify current gate position

### Common Mistakes to Avoid

❌ Starting Shopify draft before BuckyDrop complete
❌ Sourcing without checking duplicates
❌ Picking unreliable vendors
❌ Skipping cost calculation
❌ Pricing below 2× cost
❌ Publishing active instead of draft
❌ Leaving Chinese faces in photos
❌ Relying on memory instead of ledger

✅ Always check BuckyDrop gate before draft
✅ Always verify vendor reputation
✅ Always get FULL cost breakdown
✅ Always 50% minimum margin
✅ Always save as DRAFT
✅ Always update ledger after each step
