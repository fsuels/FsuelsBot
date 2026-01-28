# Council Session: Self-Improving AI Agent Architecture
**Date:** 2025-01-28
**Question:** How to design a self-improving AI agent combining Musk (delete complexity), Karpathy (verify fast), Hassabis (self-play, smallest brain, domain personas, curiosity, hierarchical goals), and Carson (nightly compound engineering loop)
**Panelists:** Grok (X/browser), ChatGPT 5.2 (browser), Gemini (CLI — UNAVAILABLE, failed all attempts)

---

## ROUND A — Initial Positions

### 🤖 GROK's Position (Round A)

**Architecture Name:** "Clawdbot 2.0"

**MUSK DELETIONS:**
1. DELETE 4-layer memory entirely → consolidate into single "Knowledge Vault" (Git repo with Markdown)
2. DELETE council as default → escalation-only
3. DELETE 30-min heartbeats → event-triggered (Shopify webhooks)
4. DELETE auto-commit at 11 PM → fold into nightly loop
5. DELETE research cron jobs → integrate into curiosity engine

**Tech Stack:** Python + Claude API + Git + Streamlit GUI + Shopify API

**Model Routing:** Local script (free) → small/free model (Grok/ChatGPT) → Claude → council (only if score <70%)

**4 Personas** (lightweight, 100-word prompt prefixes — main bot assumes on-the-fly):
- Copywriter (content tasks)
- Competitive Analyst (research/pricing)
- Operations Optimizer (fulfillment/automation)
- Curiosity Explorer (anomaly detection)

**Curiosity Engine:** Python script at 9 PM scanning Shopify data for statistical outliers via pandas. Generates 1-3 new backlog tasks.

**Auto-Scoring (0-100):**
- Completeness: 50 pts (rule-based)
- Accuracy: 20 pts (API fact-checks)
- Quality: 20 pts (free AI rating)
- Conciseness: 10 pts (<500 words)
- Threshold: 70%. Below = re-iterate with escalation.

**Goal Hierarchy (YAML):**
- Top Goal: Revenue ($50K/mo)
  - Sub-Goal 1: Inventory Optimization (KPI: stockouts -50%)
  - Sub-Goal 2: Marketing Enhancement (KPI: traffic +30%)
  - Sub-Goal 3: Operations Efficiency (KPI: manual work -40%)
- Tasks prioritized by impact score / effort

**Nightly Loop:**
- Phase 1 (10:30 PM): Review + learn + update personas/goals/backlog → push to Git
- Phase 2 (11:00 PM): Pick top task → execute → auto-score → ship PR or deploy directly to Shopify
- Morning: Email summary + GUI dashboard for human check

**Build Estimate:** 1-2 weeks, ~500 lines Python

---

### 🟢 CHATGPT's Position (Round A)

**North-Star Constraint (Karpathy):** "Human verification is the bottleneck" — every output must be GUI-verifiable (≤1 page diff, ≤10 screenshots, ≤5 metrics, ≤1 rollback plan)

**MUSK DELETIONS:**
1. DELETE council-by-default → escalation only
2. DELETE 30-min heartbeats → event-driven + 1 daily health check
3. DELETE research crons → curiosity engine
4. DELETE generic sub-agent spawning → fixed persona modules
5. DELETE auto-commit without gating → PR-only, no auto-merge
6. **KEEP 4-layer memory** (unlike Grok)

**Architecture (3 planes):**
- Control Plane: Scheduler, Event bus, Task router, Policy engine, Artifact registry
- Data Plane: Shopify data, ad exports, support inbox, content assets, backlog/objectives
- Execution Plane: Local runner, Shopify sandbox/preview, automation executor

**4-Lane Deterministic Model Routing:**
- Lane 0: Script rules (no model) — price rounding, tagging, heuristics
- Lane 1: Small model (cheap/fast) — copy variants, categorization, extraction
- Lane 2: Claude — multi-step reasoning, instruction writing, experiment design
- Lane 3: Council (rare) — high-stakes decisions, conflicting signals, low-confidence scores

**3-Type Scoring (Hybrid):**
- Hard Metrics (objective): keyword coverage, compliance checks, forbidden claims, reading grade
- Proxy Metrics (semi-objective): brand voice classifier, embedding similarity to best copy, clarity rules
- Human-Verification Cost (Karpathy score): "How fast can human verify?" — must compress if <80

**Self-Play Loop:** Generate → auto-score → targeted correction (not rewrite) → re-score → max 3 iterations → escalate lane if still failing

**4-Level Goal Hierarchy:**
- Level 0: Business Objectives (quarterly) — margin, CVR, refund rate, repeat purchases
- Level 1: Strategies (monthly) — page clarity, sizing accuracy, creative throughput, bundling
- Level 2: Programs (weekly) — Sizing & Fit, Creative Velocity, Top 20 SKU Lift, Refund Root Causes
- Level 3: Tasks (daily) — each declares parent objective, expected impact, verification artifact, rollback plan, risk level

**5 Personas (prompt + schema + scorer + tool permissions):**
- Merchandiser (pricing/bundles/margins)
- Conversion Copywriter (titles/descriptions/FAQs)
- Creative Director (ad concepts/hooks/storyboards)
- CX Analyst (refund reasons/reviews/support)
- Growth Analyst (experiment design/measurement)

**Curiosity Engine:** Anomaly detection + "what doesn't fit?" prompts. Watches CVR drops, refund spikes, cart abandonment, ROAS drops, sentiment shifts, shipping delays. Outputs "curiosity tickets" with anomaly summary, hypotheses (max 3), minimal next probe, proposed task.

**Nightly Carson Loop:**
- Phase 1 (10:30 PM): Learn & Update — summarize changes (max 10 bullets), extract rules (max 5), update instruction files, lint schemas, open PR
- Phase 2 (11:00 PM): Ship #1 Priority — select top overnight-safe task by (Impact × Confidence)/Effort, choose persona + smallest lane, generate + auto-score + compress, execute in sandbox/draft, produce PR with ≤7 bullets + preview + scorecard + rollback + checklist

**Overnight-Safe Allowlist:**
- ALLOWED: Draft listings, ad creative concepts, theme preview changes, email drafts, price proposals
- NOT ALLOWED: Policy changes, live ad budgets, publishing products, regulated claims

**Build Plan:** 4 things first: Backlog+goal tree, Router+personas, Auto-scoring service, Nightly runner

---

## ROUND B — Cross-Examination

### 🤖 GROK's Revised Position (after seeing ChatGPT's arguments)

**Agreements:**
1. Event-driven triggers ✅
2. Deterministic 4-lane model routing ✅
3. Enhanced personas with schema/scorer/permissions ✅
4. Task declarations linking to objectives ✅
5. Overnight safety (drafts/PRs) ✅
6. Phased incremental build ✅

**Attacks on ChatGPT:**
1. **4-layer memory is anti-Musk.** "Clinging to 4 layers screams fear of change, not ruthless deletion." Git versioning makes layers obsolete. Why spare memory when heartbeats/crons are axed for the same reason?
2. **4-level hierarchy is corporate bloat.** "Quarterly objectives are laughable" for fast-moving dropshipping where trends change weekly. 3 levels (goal → strategies → tasks) is sufficient.
3. **3-type scoring is overcomplicated.** Proxy metrics (embeddings, brand voice classifiers) bloat "smallest brain" principle. Verification-cost is meta and hard to quantify. Single 0-100 aggregate suffices.
4. **5 personas are arbitrary.** Should be tailored to mommy-and-me business (e.g., "Family Copywriter" not generic "Conversion Copywriter").
5. **Overnight-only-drafts is too conservative.** Misses Carson's "shipped work" promise.
6. **Missing GUI and output constraints.** No mention of Karpathy's fast visual checks.
7. **Build plan too narrow.** Misses testing/integration.

**Grok's Revised Architecture:**
- **2-layer Knowledge Vault** (compromise): Activity Log (chronological) + Insights DB (searchable YAML)
- 4-lane routing (adopted from ChatGPT's deterministic lanes)
- **4 tailored personas** with schema/scorer/perms: Family Copywriter, Trend Analyst, Ops Automator, Curiosity Detective
- **3-level hierarchy** (goals → strategies → tasks with declarations)
- **2-type scoring**: Hard metrics (70%) + Quality via free AI (30%). Threshold 70%.
- Strict drafts/PRs overnight with rollback
- **10-day build:** Days 1-2 backlog/goals/vault, 3-4 router/personas, 5-6 scoring/curiosity, 7-8 nightly runner/triggers, 9-10 GUI/testing

---

### 🟢 CHATGPT's Revised Position (after seeing Grok's arguments)

**Agreements with Grok:**
1. "Delete complexity" directionally correct — Git-based Knowledge Vault is good ✅
2. GUI verification dashboard is "big win" ✅
3. Curiosity as outlier detector is right mechanism ✅
4. YAML goal hierarchy is buildable and enforceable ✅

**Attacks on Grok:**
1. **Deleting 4-layer memory entirely is OVERCORRECTION.** Need recall_pack.md for fast task context (Karpathy) + event_ledger.md for auditability. "These aren't memory for memory's sake." Revised: Knowledge Vault + 2 lightweight derived views.
2. **100-word prompt prefix is TOO THIN for personas.** Will get inconsistent outputs, weak tool discipline, unscorable artifacts, accidental policy violations. "Hassabis' inductive biases isn't roleplay; it's task-specific contracts." Keep 4 personas but add output schema + scoring rubric + allowed tools.
3. **Auto-scoring rubric not robust.** Completeness (50pts) is gameable; API accuracy is limited; AI-rating-AI is circular and drifts; word count ≠ verification time. Revised scoring: Verification Cost Score + Policy/claims safety (hard gate) + Task-specific checks + Regression checks.
4. **DIRECTLY DEPLOYING TO SHOPIFY is the BIGGEST RISK.** "Unreviewed live changes are how you get broken themes, price mistakes, policy violations." Revised: Two-tier execution — Tier 1 (safe auto-apply for low-blast-radius) + Tier 2 (review-required for publishing/prices/ads).
5. **"500 lines in 1-2 weeks" is optimistic.** Once you add dashboard, Shopify integration, scoring, nightly loops, PR automation, safety gates — 500 lines becomes "fragile glue." MVP possible if scope strictly constrained to 1 dashboard, 1 curiosity script, 1 scoring pipeline, 1 nightly runner, 2-3 task types.
6. **Missing critical elements:** Model routing implementation, self-play iteration loop, hard safety policy layer, artifact discipline (previews/screenshots/rollback as mandatory), idempotency for Shopify API, connecting anomalies → objectives → task selection.

**ChatGPT's Revised Architecture:**
- Knowledge system: Knowledge Vault (Git, canonical) + recall_pack.md (daily regenerated) + event_ledger.md (append-only audit) — everything else deleted
- Personas enhanced but still "one bot" — prompt prefix + output schema + scoring rubric + allowed tools
- Scoring changed to Verification Cost Score + Policy safety + Task-specific checks + Regression checks
- Two-tier overnight execution: Tier 1 safe auto-apply, Tier 2 review-required
- MVP in 1-2 weeks if scope constrained

---

## 💎 GEMINI — UNAVAILABLE
Gemini CLI was unresponsive throughout the session (multiple attempts, all failed with exit code 1 or hangs). Noted per protocol and proceeding without.

---

## ANALYSIS

### ✅ CONSENSUS (both agree after debate):
1. **Event-driven triggers** replace 30-min heartbeats ✅
2. **4-lane deterministic model routing** (script → small model → Claude → council) ✅
3. **Council is escalation-only**, not default ✅
4. **Delete research crons** → replace with curiosity engine ✅
5. **Auto-commit replaced by PR-only** with gating ✅
6. **Domain personas** need output schema + scoring rubric + tool permissions ✅
7. **Goal hierarchy as code** (YAML, machine-readable) ✅
8. **Every task must declare** parent objective, expected impact, verification artifact, rollback ✅
9. **Curiosity engine** = anomaly/outlier detection generating backlog tasks ✅
10. **Nightly two-phase Carson loop** at 10:30 PM + 11:00 PM ✅
11. **GUI dashboard** for morning human verification ✅
12. **Phased incremental build** starting with core components ✅

### ⚔️ KEY DISAGREEMENTS:
1. **Memory layers:** Grok wants 1-2 layers (delete most), ChatGPT wants Knowledge Vault + 2 derived views (recall_pack + event_ledger). Both compromise from original positions.
2. **Goal hierarchy depth:** Grok says 3 levels (too rigid for e-commerce), ChatGPT says 4 levels. Grok calls 4 levels "corporate bloat."
3. **Scoring complexity:** Grok wants simple 2-type scoring (hard + quality), ChatGPT wants verification-cost score + policy safety + task-specific + regression checks. Grok calls ChatGPT's approach overcomplicated.
4. **Persona count:** Grok says 4 (tailored to mommy-and-me), ChatGPT says 5 (broader business functions).
5. **Overnight autonomy:** Grok wants more aggressive shipping (some direct Shopify deploys), ChatGPT wants strict two-tier system (Tier 1 safe auto-apply, Tier 2 review-required).
6. **Build estimate:** Grok says 10 days/500 lines, ChatGPT says 1-2 weeks MVP only if scope tightly constrained, warns about "fragile glue."

### ⚡ UNIQUE INSIGHTS:
- **ChatGPT:** "Verification Cost Score" as a mandatory metric — agent must compress output if verification cost too high. This is a novel Karpathy-native scoring dimension neither AI proposed initially.
- **ChatGPT:** "Self-play loop" concretely defined: generate → score → targeted correction (not rewrite) → re-score → max 3 iterations → escalate lane.
- **ChatGPT:** "Policy engine" as hard deterministic layer (brand voice, refund policy, compliance) — not scored, just pass/fail gates.
- **ChatGPT:** "Artifact registry" — every run produces diffs, screenshots, CSVs, previews, and scorecards. Mandatory, not optional.
- **Grok:** "Knowledge Vault as Git repo" — simple, versionable, searchable. Delete layers, use Git for history.
- **Grok:** "Curiosity Detective" as a dedicated persona — not just an engine, but a persona with its own scoring rubric.
- **Grok:** "Family Copywriter" — personas should be domain-tailored (mommy-and-me fashion), not generic business functions.
- **Grok:** Running curiosity at 9 PM (before nightly loop) so discoveries feed Phase 2 task selection.

### 🕳️ BLIND SPOTS (neither addressed):
1. **Error recovery / circuit breakers** — what happens when the nightly loop fails halfway?
2. **Token/cost tracking** — how to monitor Claude Max usage to avoid hitting limits
3. **Human feedback loop** — how morning approvals/rejections feed back into scoring and persona improvement
4. **Multi-task shipping** — both assume ship #1 task per night; what about parallel task execution?
5. **Seasonal awareness** — mommy-and-me outfits have seasonal patterns (back-to-school, holidays) that should influence goals
