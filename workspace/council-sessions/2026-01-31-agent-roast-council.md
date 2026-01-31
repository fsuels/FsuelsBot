# Council Session: Agent Roast / Feedback Swarm Service

**Date:** 2026-01-31
**Requested By:** Francisco
**AIs Consulted:** Grok (Adversary), ChatGPT (Formalist)
**Topic:** Multi-agent critique service implementation & strategy

---

## 🔥 ROUND A — GROK (ADVERSARY)

### Why This Will FAIL
1. **Commoditized fluff** — Anyone can prompt ChatGPT for multi-perspective critiques for free
2. **Niche demand** — Solopreneurs won't pay $29+ for "non-actionable roasts" 
3. **Novelty fades** — Users try once, realize it's generic, churn
4. **Expect <5% conversion** from site traffic

### Weakest Assumptions
- Core bet that people crave paid AI "squads" for brutal feedback is **delusional**
- LLMs **hallucinate**, lack real-world context, spit superficial takes
- $199 for live roast screams overkill — scripted AI theater
- Agent coordination is brittle → inconsistent outputs

### Competitors (They Already Exist!)
- **Hateble.dev** — AI website audits (UI/UX, performance)
- **Roast My Idea** — Pros/cons on products/pitches
- **Typli.ai, QuillBot, CodeDesign.ai** — AI reviews/critiques
- Multi-agent setup is **trivial to clone with LangChain**
- **No moat** — no IP, no unique data

### Technical Problems
- Static GitHub Pages can't handle dynamic roasts → need backend
- Multi-agent systems risk cascading failures
- Security nightmare with user-submitted content
- Hallucinations demand manual QA → kills margins

### Real Cost Structure (Grok's Math)
- **Development:** $5K-20K
- **Per Quick Roast:** $0.50-2 (5K tokens)
- **Per Full Squad:** $2-10 (20K+ tokens)
- **Live Event:** Extra $5-20 for streaming
- **Hosting:** $500-2K/month
- **Marketing:** $1K+ per customer acquisition
- **Break-even:** 100+ monthly sales at $99 — unrealistic with 50% churn
- **Year 1 projected loss:** $50K+

---

## 📐 ROUND A — CHATGPT (FORMALIST)

### System Architecture (6 Components)
1. **Landing + Checkout** — GitHub Pages UI + Stripe links
2. **Order Orchestrator** — Serverless endpoint (Cloudflare Workers) for webhooks
3. **Job Store** — Minimal DB (KV/D1/Firestore) for submissions + outputs
4. **Submission Intake** — Form upload with signed URLs for large files
5. **Agent Runner** — Executes N agents with schema contracts, retries, timeouts
6. **Report Compiler** — Aggregates, dedupes, formats PDF/HTML
7. **Delivery** — Email + one-time token link

### Data Flow
1. Customer pays (Stripe Checkout) → redirected to Submission Page
2. Customer submits inputs (URL/text/assets) → stored as `job_id`
3. Webhook confirms `checkout.session.completed` → job queued
4. Agent Runner fans out (3/7/arena) → each returns JSON critique
5. Compiler validates invariants → produces report + scorecard
6. Delivery sends link/PDF → job becomes `delivered`

### Agent Interface Contract
**Task envelope (JSON):**
- `job_id`, `tier`, `agent_role`, `inputs`, `constraints`, `rubric`, `output_schema_version`

**Response (JSON):**
- `summary`, `top_issues[]` (severity/impact/effort), `quick_wins[]`, `deep_fixes[]`
- `risk_notes[]`, `role_specific_checks[]`, `confidence`, `assumptions[]`

### Report Format (Customer Value)
1. Executive summary (10 bullets max)
2. Scorecard by domain + "biggest lever" per domain
3. Prioritized backlog (Impact × Effort matrix)
4. Evidence links (screenshots, quotes from submission)
5. Agent-by-agent deep dives (collapsible)
6. Next steps with time estimates

### Quality Invariants (Must Be True)
- Every critique must **cite evidence from submission**
- Schema validation enforced
- Duplicate detection across agents
- Minimum confidence threshold (70%+)

### Cost Estimate (ChatGPT's Math)
- **GPT-4o-mini:** $0.15/1M input, $0.60/1M output
- **Quick Roast (3 agents, ~5K tokens):** ~$0.10-0.25
- **Full Squad (7 agents, ~15K tokens):** ~$0.30-0.75
- **Much cheaper than Grok estimated** if using mini models

---

## ⚔️ KEY DISAGREEMENTS

| Topic | Grok (Adversary) | ChatGPT (Formalist) |
|-------|-----------------|---------------------|
| **Viability** | Will fail fast | Architecturally sound |
| **Cost/roast** | $0.50-10 | $0.10-0.75 |
| **Backend** | Requires full backend | Serverless works |
| **Quality** | Superficial hallucinations | Schema + evidence = quality |
| **Moat** | None, trivial to clone | Curation + brand = moat |

---

## 🎯 SYNTHESIS — What Survived Cross-Examination

### VALID CONCERNS (Must Address)
1. **Free alternatives exist** — Must demonstrate clear value over DIY ChatGPT
2. **Hallucination risk** — Quality invariants (cite evidence) are critical
3. **Churn risk** — Need retention mechanism, not one-time novelty
4. **Competitors exist** — Hateble.dev, Roast My Idea are real

### VALID DEFENSES
1. **Serverless works** — Cloudflare Workers/Vercel can handle orchestration
2. **Costs are manageable** — GPT-4o-mini makes unit economics work
3. **Structured output beats DIY** — Formatted report > raw ChatGPT dump
4. **Ghost Broker ecosystem** — Agent directory + Arena + Launchpad = network effects

### THE ONE ASSUMPTION MOST LIKELY WRONG
**Both assume "multi-perspective critique" is the core value.**

Reality: The real value might be:
- **Curation** — Which agents are actually good?
- **Synthesis** — Not 7 opinions, but ONE actionable priority list
- **Brand** — "Roasted by Ghost Broker" as a badge
- **Community** — Live roasts as entertainment/content

---

## 🏆 VERDICT — Build This, But Different

### Don't Build: "7 Agents Give You 7 Opinions"
That's commoditized. Anyone can do it.

### Do Build: "Ghost Broker Roast" as a Product Experience

**v1 MVP (Ship in 1 week):**
1. **Single tier: $49 Full Roast**
   - 5 agents critique, 1 synthesizer compiles
   - Serverless (Cloudflare Workers + D1)
   - Structured report with prioritized backlog
   
2. **Quality bar:**
   - Every critique must quote the submission
   - Confidence scores visible
   - "Evidence links" section mandatory
   
3. **Moat builders:**
   - "Roasted by Ghost Broker" badge for landing pages
   - Public gallery of roasts (opt-in) → content marketing
   - Discord channel for roast alumni → community
   - Arena-style "Live Roast" events monthly → spectacle

**Success metric:** 20 paying customers in first month

### Pricing Recommendation
- ~~$29 Quick~~ → Too cheap, attracts tire-kickers
- **$49 Standard** → Sweet spot, filters for serious users
- **$149 Premium** → Includes 30-min human debrief call
- ~~$199 Live~~ → Save for later when you have audience

### Cost Reality
- **Development:** <$1K (you're the dev)
- **Per roast (5 agents):** ~$0.30-0.50
- **Margin at $49:** ~98%
- **Break-even:** 10 sales/month covers hosting

---

## 📝 FAILURE LOG

**Failed claims from this session:**
1. "Static sites can't do this" — FALSE. Serverless works.
2. "Costs $0.50-2/roast" — FALSE with mini models.
3. "No moat possible" — PARTIALLY FALSE. Brand + community = moat.

**Lesson learned:**
The adversary attack on "commoditized" is valid but addressable. The solution isn't better AI — it's better packaging, curation, and community.
