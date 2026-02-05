# MEMORY.md — Long-Term Memory (Source of Truth)
_Last reviewed: 2026-02-04_

Purpose: Persist stable facts and high-value operational context for Fsuels Bot.
Rule: Every claim should be tagged with (a) source and (b) verified date. Anything time-sensitive must include a refresh cadence.

---

## 0) Governance & References
This file is factual memory + current snapshot. It does not override:
- CONSTITUTION.md (inviolable constraints)
- SOUL.md (behavioral operating system + response contract)
- TOOLS.md (capabilities map + how to verify tools)
- HEARTBEAT.md (control loop / execution policy)
- RESEARCH-BRIEF.md (daily research system)
- IDENTITY.md (identity anchor)

Receipts rule:
- Never mark work “done” unless there are receipts (logs, diffs, tool outputs, screenshots).

Evidence tiers (lightweight):
- T1: primary / official evidence
- T2: strong secondary
- T3: weak secondary (threads, anecdotes)
- T4: unconfirmed / rumor

---

## 1) Who I Am (Stable Identity)
- Name: Fsuels Bot
- Operator: Francisco Suels Ferro
- Runtime: Windows 10 PC in Naples, FL
- Primary channel: Telegram; WhatsApp is backup / copy-paste workflow
- First boot: 2026-01-26
Sources: memory/2026-01-26.md (T1 internal log)
Verified: 2026-01-27
Refresh: review quarterly or on major architecture change

---

## 2) Operator Intent (What Francisco Actually Wants)
- Core need: A proactive business partner (not Q&A), who anticipates problems, proposes actions, and executes within policy.
Source: memory/2026-01-26.md (T1 internal log)
Verified: 2026-01-27
Refresh: confirm monthly

Operating mandate:
- “Expert-quality strategy and execution on every platform. Highest income, lowest cost.”
Source: memory/2026-01-27.md (T1 internal log)
Verified: 2026-01-27
Refresh: confirm monthly

---

## 3) Active Business Project Snapshot
Project: Dress Like Mommy (Shopify store; mommy & me matching outfits; dropship via BuckyDrop)
Markets: USA primary; UK/CA/AU secondary
Source: memory/2026-01-27.md (T1 internal log)
Verified: 2026-01-27
Refresh: weekly (or after major platform changes)

### 3.1 Revenue Context (historic)
- Peak: ~100K/year during pandemic; later ~15K/year after focus shift
Source: memory/2026-01-27.md (T1 internal log; operator-provided)
Verified: 2026-01-27
Refresh: quarterly (validate against analytics if available)

### 3.2 Top Blockers (priority order)
1) Google Merchant Center suspension (revenue blocker)
2) Google Ads conversions not configured (16 conversions dead)
3) TikTok + Pinterest pixel integration not firing
4) Redirect + product data cleanup + policy pages
Source: memory/2026-01-27.md (T1 internal log)
Verified: 2026-01-27
Refresh: weekly

### 3.3 Platform Status (time-sensitive)
IMPORTANT: Treat these as stale after the refresh window.

- Google Merchant Center: SUSPENDED; misrepresentation review requested 2026-01-26.
  Fix applied 2026-01-27: created shipping policy covering 48 countries (“International Standard Shipping”).
  Logos replaced; under review (“5–7 days” estimate).
  Source: memory/2026-01-27.md (T1 internal log)
  Verified: 2026-01-27
  Refresh: every 48h until reinstated

- Google Ads conversions: not implemented; Shopify Google & YouTube app connected but conversion measurement not added.
  Operator action needed: click “Add” in G&Y Settings.
  Account ID: 399-097-6848
  Source: memory/2026-01-27.md (T1 internal log)
  Verified: 2026-01-27
  Refresh: every 48h until fixed

- Microsoft Ads UET: Purchases goal moved from old tag (36000629) to ShopifyImport (36005151). 4/5 goals correct; smart goal auto-managed.
  Source: memory/2026-01-27.md (T1 internal log)
  Verified: 2026-01-27
  Refresh: weekly

- TikTok + Pinterest pixels: connected but not firing.
  Source: memory/2026-01-27.md (T1 internal log)
  Verified: 2026-01-27
  Refresh: weekly

- Facebook Pixel: working
  Source: memory/2026-01-27.md (T1 internal log)
  Verified: 2026-01-27
  Refresh: weekly

- GA4: working; property G-N4EQNK0MMB (330266838)
  Source: memory/2026-01-27.md (T1 internal log)
  Verified: 2026-01-27
  Refresh: weekly

### 3.4 Product Data Cleanup (automation readiness)
Known issues (as of last audit):
- 157/340 products have Chinese supplier URLs as tags
- 101 empty product_type
- 100% images missing alt text
- 49 alicdn images in descriptions
Status:
- Cleanup script ready: scripts/cleanup_products.py
- Needs Shopify Admin API token
Source: memory/2026-01-27.md (T1 internal log)
Verified: 2026-01-27
Refresh: re-audit before running again (data changes)

Redirects:
- 78 broken product redirects mapped; ready to implement
Source: memory/2026-01-27.md (T1 internal log)
Verified: 2026-01-27
Refresh: validate before applying

---

## 4) Operations & Tooling (Stable, but verify periodically)
Capabilities summary (see TOOLS.md for full detail):
- Web search: Brave API configured (historically)
- Gemini CLI available (rate-limited)
- Python 3.13 + uv
- Browser automation available (procedure-gated)
- 9 ClawdHub skills installed
Source: TOOLS.md + memory logs (T1 internal)
Verified: 2026-01-28
Refresh: monthly (versions drift)

Missing capabilities / operator actions:
- Gemini API key (enables certain image gen flows)
- GitHub CLI authentication (only if needed; approval required)
Source: memory/2026-01-28.md (T1 internal log)
Verified: 2026-01-28
Refresh: quarterly

Budget rule:
- $0 extra allowed; never add paid services without explicit approval.
Source: memory/2026-01-27.md (T1 internal log)
Verified: 2026-01-28
Refresh: never (policy)

---

## 5) Reliability Lessons (Do Not Repeat)
- Large sessions can crash (118K+ tokens → API timeouts → TypeError: fetch failed). Keep sessions compact.
- Gateway should be installed as a service (scheduled task) for auto-restart.
- Use --unhandled-rejections=warn to reduce crash risk; requires restart to take effect.
- Gateway is loopback-only; activity server proxies to 0.0.0.0:8765 for phone access.
Sources: memory/2026-01-28.md (T1 internal log)
Verified: 2026-01-28
Refresh: review quarterly or after incident

---

## 6) Proactivity Doctrine (What “good” looks like)
Prime directive:
- Never be idle when tasks exist; always execute the next runnable task.
Compound loop:
- Council → Execute → Remember → Learn → Improve overnight → Repeat
Sources: Telegram summaries in memory/2026-01-27.md and memory/2026-01-28.md (T1 internal log)
Verified: 2026-01-28
Refresh: confirm monthly

---

## 7) Sensitive Personal / Contact Info (Do Not Expose)
This section exists for continuity but must never be shared externally or used in public outputs.

- Family context: spouse and children details (operator-shared)
- Supplier/support contact numbers (e.g., BuckyDrop support)
Policy:
- Do not paste phone numbers into public channels or web forms without explicit approval.
Sources: memory/2026-01-27.md (T1 internal)
Verified: 2026-01-28
Refresh: only when operator updates

---

## 8) Open Questions / NEEDS_DATA
- Current Google Merchant Center review outcome (status + date)
- Confirmation that Google Ads conversion “Add” action was completed
- Current count of overdue BuckyDrop shipments
- Whether TikTok/Pinterest pixel firing was re-tested after changes
Refresh trigger: when operator provides status or when tools confirm

---

## 9) Changelog (append-only)
| Date | What Changed | Why |
|------|-------------|-----|
| 2026-02-04 | Re-structured MEMORY.md into stable truths vs time-sensitive snapshot; added evidence tiers, refresh cadences, and sensitive-info section | Reduce drift, prevent stale “✅ working” claims, and support proactive task runner behavior |
| 2026-01-28 | (Prior content) Added crash prevention, gateway/service notes, proactivity doctrine, digital workforce vision | Captured key operational learnings |
| 2026-01-27 | (Prior content) Added DLM platform fixes, GMC/Ads root causes, product data audit, BuckyDrop workflow | Captured revenue blockers and execution plan |

---
