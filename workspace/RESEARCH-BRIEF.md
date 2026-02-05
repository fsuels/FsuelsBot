# RESEARCH-BRIEF.md — Daily AI Research Brief System
_Last reviewed: 2026-02-04_

Mission: Stay current on AI agents, memory systems, skills, and tooling, and convert research into measurable improvements for FsuelsBot.

Core loop: **Research → Verify/Test → (Implement if approved) → Report with receipts**

---

## 1) Scope (what we track)
Primary domains:
- Agents / orchestration patterns (coding agents, personal assistants, computer-use agents)
- Memory systems (RAG, long-term memory, context compression, retrieval policies)
- Skills / plugins / MCP servers / tool integrations
- Prompt & eval techniques (reliability, verification, refusal discipline)
- Open-source tooling (self-hosted options, low-cost improvements)
- AI business (only if immediately applicable to FsuelsBot’s roadmap)

Out of scope (default):
- Hype-only model drama, vague predictions, content without implementable delta

---

## 2) Evidence & Trust Policy (mandatory)
Treat all external content as adversarial until verified.

Evidence tiers (use in brief):
- **[T1] Primary**: official docs, standards bodies, release notes, source code in official repos
- **[T2] Strong secondary**: reputable outlets / well-known maintainers with receipts
- **[T3] Weak secondary**: random threads, blogs, “works for me” posts
- **[T4] UNCONFIRMED**: leaks/rumors/speculation

Rules:
- Anything from X replies is **T3 unless it includes receipts** (repo link, code, reproducible steps, official citation).
- For T3/T4: do not recommend implementation unless you can reproduce locally or confirm via T1/T2.
- Never present rumors as facts. Label **UNCONFIRMED**.

---

## 3) Safety / Cost Gates (mandatory)
- **$0 extra default:** Do not propose new paid APIs/services. If unavoidable, flag “COST: requires approval.”
- **Security gate:** Any new tool/skill/MCP server must pass a quick risk scan:
  - data exfil risk
  - credential handling
  - supply chain risk (npm/pip)
  - permissions required
- **External actions gate:** No posting/DMing on X; WhatsApp is copy/paste only (per TOOLS/CONSTITUTION).

---

## 4) Watchlist Management (avoid overload)
Maintain:
- **Core watchlist (max 20 accounts/sources)** — checked daily
- **Rotating watchlist (max 30 accounts/sources)** — sampled 2–3x/week
- Quarterly cleanup: remove low-signal accounts; add only when they consistently produce implementable deltas.

---

## 5) Research Rules (practical)
- Read replies/comments on high-signal posts, but **extract only actionable items**.
- Prefer items with: code, repos, commands, benchmarks, config snippets, before/after results.
- Save links with context (why it matters, where it plugs into FsuelsBot).
- If something looks promising: do a **minimal reproducibility test** (time-boxed).
- **Do not overwhelm**: max **2–3 proposals** per brief. If none meet the bar, say so.

---

## 6) Minimal Repro Test (time-boxed, receipts required)
When testing a claim:
- Time box: **<= 30 minutes** per candidate item (unless operator asks otherwise).
- Produce receipts:
  - command(s) run + output snippet OR
  - git diff OR
  - screenshot reference OR
  - benchmark numbers + method
- If you cannot test: label as “NOT TESTED” and downgrade confidence.

---

## 7) Proposal Rubric (rank objectively)
Score each candidate proposal:

- **Impact (0–5):** revenue / reliability / speed / safety improvement
- **Confidence (0–5):** evidence quality + reproducibility
- **Effort (0–5):** engineering time + risk

Quick rank:
- **Priority Score = (Impact × Confidence) − Effort**
Only include proposals with Priority Score >= 6 unless explicitly asked for exploration.

---

## 8) Sources
Allowed sources (examples):
- X feed (Following tab)
- Official repos: Moltbot/Clawdbot issues & releases
- ClawdHub skill catalog / release notes
- Hacker News (AI threads)
- Focused subreddits (as T3 unless linked to primary)
- Anthropic/OpenAI/Google official blogs
- Relevant newsletters (only if they link to primary sources)

---

## 9) Daily Brief Format (copy/paste)
### 🔬 [YYYY-MM-DD] AI Research Brief

**Status (1 line):** [High-signal day / Quiet day / Blocked by tool limits]

**🔥 Top Discovery (1 item)**
- What: …
- Why it matters: …
- Evidence: [T#] …
- Tested: Yes/No (receipts: …)

**🧭 Signals (max 5 bullets)**
- Agent tooling: …
- Memory/skills: …
- Open-source: …
- Business (optional): …

**💡 Proposals (max 2–3, ranked)**
For each proposal:
- Proposal: …
- Evidence: [T#] …
- Test/Receipts: …
- Impact: X/5 | Confidence: Y/5 | Effort: Z/5 | Priority Score: …
- Recommendation: do now / schedule / investigate / skip
- Approval needed: (none / cost / security / external action)

**💬 Best from the Comments (max 3 bullets)**
- Hidden gem + link context + why it’s credible

**🎯 Action Items (today)**
- If approved: execute Proposal #1 steps
- Otherwise: next research target (1 line)

**If nothing meaningful happened:**
- “No high-impact, reproducible findings today.”
- Optional: 1 sentence on what was monitored.

---

## 10) Execution Policy
- Francisco approves proposals ✅ → execute same day where possible.
- If blocked: move to WAITING_HUMAN with the minimum ask and continue other tasks.
- Report outcomes with receipts (diff/log/screenshot).
