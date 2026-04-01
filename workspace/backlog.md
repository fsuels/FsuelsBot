# Task Backlog

_Auto-scored by TPS = (Revenue Impact × Confidence) ÷ (Human Minutes × Reversibility Risk)_
_Updated by: nightly compound loop, curiosity engine, manual additions_

## Active Tasks

### Valentine's Day Campaign (URGENT — Feb 14)

| Task                                   | Persona    | Revenue Impact | Confidence | Human Min | Risk | TPS  | Status  |
| -------------------------------------- | ---------- | -------------- | ---------- | --------- | ---- | ---- | ------- |
| Create Valentine's Day collection page | Catalog    | 8              | 0.8        | 5         | 1    | 1.28 | pending |
| Write 10 V-Day product descriptions    | Catalog    | 7              | 0.7        | 10        | 1    | 0.49 | pending |
| Research V-Day competitor strategies   | Traffic    | 6              | 0.9        | 3         | 1    | 1.80 | pending |
| Draft V-Day email campaign             | Conversion | 7              | 0.6        | 5         | 2    | 0.42 | pending |
| V-Day SEO keyword optimization         | Traffic    | 6              | 0.7        | 5         | 1    | 0.84 | pending |

### GMC Reinstatement (CRITICAL — Distribution Blocked)

| Task                                      | Persona | Revenue Impact | Confidence | Human Min | Risk | TPS  | Status                                                   |
| ----------------------------------------- | ------- | -------------- | ---------- | --------- | ---- | ---- | -------------------------------------------------------- |
| Audit GMC suspension requirements         | Traffic | 10             | 0.8        | 10        | 1    | 0.80 | pending                                                  |
| Fix product data feed issues              | Catalog | 10             | 0.6        | 15        | 2    | 0.20 | pending                                                  |
| Research GMC reinstatement best practices | Traffic | 9              | 0.9        | 3         | 1    | 2.70 | done (see knowledge/gmc-reinstatement-best-practices.md) |

### Store Optimization (Ongoing)

| Task                           | Persona    | Revenue Impact | Confidence | Human Min | Risk | TPS  | Status  |
| ------------------------------ | ---------- | -------------- | ---------- | --------- | ---- | ---- | ------- |
| Audit top 10 product SEO tags  | Traffic    | 5              | 0.8        | 5         | 1    | 0.80 | pending |
| Fix ScamAdviser trust score    | Traffic    | 7              | 0.5        | 10        | 2    | 0.18 | pending |
| Product description template   | Catalog    | 6              | 0.9        | 3         | 1    | 1.80 | pending |
| Conversion audit of top 5 PDPs | Conversion | 6              | 0.7        | 5         | 1    | 0.84 | pending |

---

## Curiosity Engine Proposals (2026-03-18 9:00 PM)

### Proposal 1: Unblock daily ops by standardizing “WAITING_HUMAN” prerequisites (logins/approvals) into one checklist

- **Discovery:** Many cron tasks are consistently blocked by the same prerequisites: (1) logged-in browser sessions (X, LinkedIn, Outlook, BuckyDrop), (2) Tier-2 approval for public actions.
- **Why it matters:** Reduces repeated stalls; makes it easy for Francisco to grant access once, then tasks run autonomously.
- **Suggested task:** Create `procedures/waiting-human-prereqs.md` + a 1-screen checklist Francisco can follow (attach Chrome tab via Browser Relay; confirm which accounts are authorized; approve allowed public actions scope). Update blocked tasks to reference that checklist.
- **TPS estimate:** Revenue Impact 5 × Confidence 0.8 ÷ Human Min 12 ÷ Risk 1 = **0.28**
- **Persona:** Ops / Throughput

### Proposal 2: Epistemic review automation fallback when ChatGPT/Grok sessions aren’t available

- **Discovery:** Evening epistemic review rotation can’t run when the required reviewer isn’t authenticated in the available browser runtime (common blocker).
- **Why it matters:** This is a safety mechanism; if it fails repeatedly, errors compound unnoticed.
- **Suggested task:** Update `procedures/epistemic-review.md` to include an explicit fallback chain: preferred reviewer by rotation → if not logged in, use Gemini CLI (still external) + record “fallback used” in `memory/epistemic-reviews.jsonl`.
- **TPS estimate:** Revenue Impact 4 × Confidence 0.85 ÷ Human Min 10 ÷ Risk 1 = **0.34**
- **Persona:** Safety / Quality

---

## Curiosity Engine Proposals (2026-03-17 9:00 PM)

### Proposal 1: Eliminate inline PowerShell breakage with a minimal repro + wrapper

- **Discovery:** This runtime appears to strip `$var` assignments in inline PowerShell one-liners (e.g., `$x=1` becoming `=1`). Grok flagged “hasty generalization risk” unless we scope + reproduce.
- **Why it matters:** It creates recurring command failures + slows execution (recentErrors stays high).
- **Suggested task:** Add a tiny reproducible test script + document the scope (“this agent runtime / toolchain”), and add a helper pattern (prefer file-based `.ps1` scripts or Python for JSON parsing).
- **TPS estimate:** Revenue Impact 4 × Confidence 0.9 ÷ Human Min 8 ÷ Risk 1 = **0.45**
- **Persona:** Ops / Reliability

---

## Curiosity Engine Proposals (2026-03-16 9:00 PM)

### Proposal 1: Stop PowerShell one-liner breakage (reduce recentErrors)

- **Discovery:** In this heartbeat runtime, inline PowerShell containing `$var=...` gets `$var` stripped before execution (e.g. `$x=1` becomes `=1`) causing many command failures.
- **Why it matters:** This creates noisy failure logs and slows execution; it’s a repeat error source.
- **Suggested task:** Add a small wrapper script/procedure: avoid `$` in one-liners, prefer file-based scripts or `Set-Variable`, or use Python for JSON parsing.
- **TPS estimate:** Revenue Impact 4 × Confidence 0.9 ÷ Human Min 10 ÷ Risk 1 = **0.36**
- **Persona:** Ops / Reliability

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

_(moved here after execution with score)_

## Deleted Tasks

_(moved here with reason — 5-step applied)_

## Curiosity Engine Proposals (2026-02-03)

| Proposal                                                                                                      | Persona | Revenue Impact | Confidence | Human Min | Risk |  TPS | Notes                                                               |
| ------------------------------------------------------------------------------------------------------------- | ------: | -------------: | ---------: | --------: | ---: | ---: | ------------------------------------------------------------------- |
| Speed: Terminator MCP session reuse + keep agent warm (cut WhatsApp macro from ~50s to <10s)                  |     Ops |              6 |        0.8 |        30 |    1 | 0.16 | Biggest bottleneck: repeated MCP init + extra get_window_tree calls |
| Reliability: auto-create today's memory/YYYY-MM-DD.md during heartbeat checks (remove warning, better audits) |     Ops |              3 |        0.9 |         5 |    1 | 0.54 | Prevents missing today file and makes nightly reviews consistent    |
| Quiet mode: send Telegram only on ALERT start/clear (state-change notifications)                              |     Ops |              4 |        0.8 |        10 |    1 | 0.32 | Keeps 5-min checks without flooding chat                            |
