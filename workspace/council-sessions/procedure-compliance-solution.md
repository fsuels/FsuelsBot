# Council Session: Bulletproof Procedure Compliance System
**Date:** 2026-01-29
**Participants:** Grok, ChatGPT, Claude (synthesizer)
**Status:** COMPLETE

---

## The Problem
Claude (me) consistently forgets to read procedure files before acting, making the same mistakes repeatedly. Context windows reset between sessions, so memory doesn't persist naturally.

---

## Round 1: Initial Proposals

### Grok's Approach
- External orchestration layer (Python middleware)
- Vector database for semantic search
- Auto-inject procedures into prompt
- Post-action audit logging
- Supervisor AI verification

### ChatGPT's Approach
- Canonical Procedure Registry (Git-backed YAML/JSON)
- Deterministic routing table (task_type → procedure IDs)
- Two-phase execution: Plan → Execute
- Tool gating with Procedure Snapshot Token
- Evidence ledger with machine-checkable artifacts
- Deterministic workflow execution (state machine)

---

## Round 2: Cross-Examination & Critiques

### Critiques of Vector Search (ChatGPT → Grok)
1. **Not reliable for guarantees** — can retrieve wrong procedure, miss mandatory ones
2. **Silent degradation** — no hard failure signal when retrieval fails
3. **Force-feeding doesn't ensure usage** — model can ignore injected procedures
4. **Supervisor AI is probabilistic** — can rubber-stamp incorrectly

### Critiques of State Machine (Grok → ChatGPT)
1. **Over-rigidity** — doesn't handle ad-hoc tasks well
2. **AI can subvert via parameters** — null values, malicious params
3. **No procedure discovery** — assumes perfect upfront mapping
4. **Implementation gaps** — vague on error handling, rollbacks

---

## FINAL CONSENSUS: Hybrid Architecture

### Core Principles (Both Agreed)
1. **Don't trust AI memory** — external system enforces everything
2. **Deterministic routing FIRST** — vector search is advisory only
3. **Version-pinned procedures** — hash-verified, immutable per session
4. **Token-gated execution** — no tools without proof of procedure reading
5. **Evidence-backed verification** — machine-checkable artifacts, not prose
6. **Supervisor AI = backstop only** — not primary enforcement

---

## IMPLEMENTATION SPEC

### 1. Procedure Registry
**Location:** `procedures/` directory
**Format:** YAML with schema

```yaml
# procedures/PROC-001-browser.yaml
id: PROC-001
title: Browser Protocol
version: 1.0
hash: sha256:abc123...
scope: 
  - browser
  - navigation
  - tabs
triggers:
  - browser
  - tab
  - navigate
  - shopify
  - 1688
  - buckydrop
preconditions:
  - must_call: browser_tabs
    before: any_browser_action
steps:
  - id: step-1
    action: "Check existing tabs with browser tabs"
    required_evidence: tab_list_output
  - id: step-2
    action: "Navigate within existing tab if domain matches"
    required_evidence: navigation_output
  - id: step-3
    action: "Close tabs when done"
    required_evidence: close_confirmation
forbidden_actions:
  - "Open new tab when same domain already open"
  - "Skip browser tabs check"
postconditions:
  - max_tabs_per_domain: 1
```

### 2. Routing Table
**Location:** `procedures/routing.json`

```json
{
  "routes": {
    "browser": ["PROC-001-browser"],
    "product_listing": ["PROC-002-listing", "PROC-003-pricing"],
    "pricing": ["PROC-003-pricing"],
    "1688": ["PROC-001-browser", "PROC-002-listing"],
    "buckydrop": ["PROC-001-browser", "PROC-002-listing", "PROC-003-pricing"],
    "shopify": ["PROC-001-browser", "PROC-002-listing"]
  },
  "trigger_keywords": {
    "browser": ["browser", "tab", "navigate", "open", "click"],
    "product_listing": ["list", "listing", "draft", "product", "import"],
    "pricing": ["price", "cost", "margin", "profit"]
  }
}
```

### 3. Pre-Action Checkpoint (System Prompt Injection)

Add to AGENTS.md — the system ALREADY injects this, but make it MANDATORY:

```markdown
## 🚨 PROCEDURE CHECKPOINT (MANDATORY)

**Before starting ANY task in these domains, STOP and read the procedure file:**

| If task involves... | READ FIRST | Trigger words |
|---------------------|------------|---------------|
| 🌐 Browser/websites | `procedures/browser.md` | browser, tab, navigate, shopify, 1688, buckydrop |
| 📦 Product listings | `procedures/product-listing.md` | list, listing, draft, product, import |
| 💰 Pricing | `procedures/pricing.md` | price, cost, margin, profit |

**Enforcement:**
1. See trigger word in task → STOP
2. Read the procedure file completely
3. State the verification gate in your response
4. THEN proceed with the task

**If you catch yourself acting without reading the procedure → STOP IMMEDIATELY and read it.**
```

### 4. Evidence Ledger
**Location:** `memory/compliance-log.jsonl`
**Format:** Append-only JSONL

```json
{"ts":"2026-01-29T01:00:00-05:00","run_id":"RUN-001","proc_id":"PROC-001","step_id":"step-1","evidence":"browser_tabs_output:3_tabs_open","status":"pass"}
```

### 5. Verification Gates (In Procedure Files)

Each procedure file ends with a verification gate the AI MUST state:

```markdown
## Verification Gate

Before ANY browser action, state:
> "Browser check: [X] tabs open. Target domain [Y] has existing tab: [yes/no]. Action: [navigate existing / open new / close first]."
```

### 6. Self-Enforcement Mechanism

Add to SOUL.md:

```markdown
## Procedure Compliance (Non-Negotiable)

I have documented procedures that I MUST follow. My failure mode is "forgetting they exist."

**Self-check before acting:**
1. Does this task involve: browser, listings, pricing, 1688, BuckyDrop, Shopify?
2. If YES → Have I read the procedure file THIS SESSION?
3. If NO → STOP. Read it. State the verification gate. Then proceed.

**If I catch myself mid-action without having read the procedure:**
- STOP immediately
- Read the procedure
- Restart the task correctly
- Note the slip in memory for self-improvement
```

---

## IMPLEMENTATION PLAN

### Phase 1: Immediate (Tonight)
1. ✅ Update AGENTS.md with PROCEDURE CHECKPOINT section
2. ✅ Update SOUL.md with compliance self-check
3. ✅ Ensure procedure files have verification gates
4. ✅ Create compliance-log.jsonl structure

### Phase 2: Tomorrow
1. Convert procedures to YAML with full schema
2. Create routing.json
3. Build validator script that checks compliance log

### Phase 3: Future (If Needed)
1. Tool gating in Clawdbot (requires code changes)
2. Procedure Snapshot Token system
3. Supervisor AI verification

---

## WHY THIS WILL WORK

The key insight from both AIs: **Don't trust me to remember. Force the reminder.**

The current system relies on me voluntarily reading procedures. The new system:
1. **Puts triggers in the system prompt** — I see them every session
2. **Uses keyword matching** — deterministic, not semantic
3. **Requires stating verification gates** — forces me to prove I read it
4. **Logs compliance** — creates accountability trail

This is the minimum viable enforcement that works within Clawdbot's architecture without code changes.

---

## COUNCIL VERDICT

**Confidence: HIGH**

Both Grok and ChatGPT converged on the same core principles. The hybrid approach combines:
- Grok's semantic awareness (for edge cases)
- ChatGPT's deterministic enforcement (for guarantees)

The implementation is practical and can be done tonight.
