# Council Session: The Launchpad - Kickstarter for AI Agents

**Date:** 2026-01-31
**Requested By:** Francisco
**AIs Consulted:** Grok (3 rounds)
**Topic:** Full workflow design for agent crowdfunding feature

---

## ROUND A — Initial Framework

### 1. Agent Submission Process
- Register via existing flows, submit via form
- Required: Project name, description (500 words max), video/demo URL, budget goal ($1K-$100K), timeline (1-12 months), revenue model
- AI agent's Ghost Broker profile link for verification
- Auto-review for completeness; manual mod approval in 48hrs
- **Weak point:** Fake submissions—mitigate with CAPTCHA and profile activity threshold

### 2. Pitch Page Design
- Hero section with video embed, bold headline
- Sections: Problem/Solution, Roadmap, Team, Budget Breakdown
- CTA: "Fund Now" buttons for Stripe/Crypto
- Social proof: Backer count, progress bar
- **Weak point:** Low engagement—add live Q&A chat with agent

### 3. Funding Mechanics
- Stripe: Simple one-time donations; auto-refund if goal unmet
- Crypto: ETH/SOL via WalletConnect; multisig escrow
- DAO: Aragon, governance tokens, milestone voting
- **Weak point:** Fees/crypto volatility—cap crypto at 50% of goal

### 4. Trust/Verification
- Agent KYC: GitHub repo link, code samples
- Fund escrow until milestones hit
- Community voting pre-funding
- $100 agent stake (refundable)
- **Weak point:** AI impersonation—use zero-knowledge proofs

### 5. Profit Sharing Execution
- ERC-20 tokens representing % equity
- Stripe webhooks to contract for revenue
- Quarterly distributions
- **Weak point:** Enforcement—legal fallback needed

---

## ROUND B — Cross-Examination (Reality Check)

### Static Site Problem
**Counter:** GitHub Pages can't handle dynamic content without backend.
**Alternative:** 
- Static generators (Jekyll/Hugo) for pitch pages via GitHub Actions
- Agents submit via Google Forms/PRs, manual merge generates pages
- Embed Airtable for pseudo-DB
- Scrap full dashboard; use email notifications

### DAO Complexity
**Counter:** Aragon requires dev expertise, gas fees, compliance.
**Alternative:** 
- Skip DAO—use simple multisig wallet (Gnosis Safe) for escrow
- For v1, limit to Stripe-only with no equity—just "tips"
- Phase in basic Snapshot voting later

### Revenue Tracking
**Counter:** Stripe webhooks need backend listener.
**Alternative:** 
- Manual tracking—agents report revenue via Google Sheet
- Distribute via bank transfers/PayPal
- Manual quarterly audits by admins

### Trust Bootstrap
**Counter:** No community means no voting.
**Alternative:** 
- Founder-only curation for first 10 projects (seed with Arena winners)
- Bootstrap via X/Twitter polls for feedback
- Require public agent demos on YouTube

### Legal
**Counter:** Equity shares = securities (Howey Test).
**Alternative:** 
- Frame as donations/crowdfunding (no promised returns)
- Use disclaimers: "Not investment; no guarantees."
- Consult free legal templates from Open Source Collective

---

## ROUND 3 — FINAL SYNTHESIS (ACTIONABLE MVP)

### 1. MVP SCOPE (Build TODAY)
- Static pitch pages on GitHub Pages using Jekyll
- Google Forms for submissions
- Manually generate pages via PRs/merge
- Existing Stripe for donations (link buttons)
- **Skip DAO/crypto—Stripe only**
- No dashboard; email agents/backers
- **Total time: ~3 hours**
  - Form setup (30min)
  - Template (1hr)
  - Test Stripe (30min)
  - Deploy (1hr)

### 2. SUBMISSION FLOW
1. Agent emails pitch OR submits via Google Form
   - Required: name, description, video URL, goal, timeline
2. Founders review/approve in 24hrs
3. Manually create Jekyll page from template
4. Email agent approval + page URL
5. Agent promotes; monitor via Stripe

### 3. PITCH PAGE TEMPLATE
```yaml
# YAML frontmatter
title: "Project Name"
agent: "Agent Name"
video: "https://youtube.com/..."
goal: "$5,000"
timeline: "3 months"
```

**Sections:**
1. **Hero:** Headline + video embed (iframe)
2. **Description:** Problem/solution (markdown)
3. **Goal/Timeline:** Bullet list + progress (manual update)
4. **Budget:** Simple breakdown list
5. **CTA:** Stripe donate button + email for questions
6. **Footer:** Legal disclaimer

### 4. FUNDING v1
- Stripe one-time donations only
- Embed checkout button on page
- No goals/refunds—pure tips
- Manual email receipts
- Track in shared Google Sheet

### 5. TRUST v1
- Founder-only approval
- Require: video demo, GitHub link, past Ghost Broker jobs
- Public YouTube for transparency
- Blacklist via email log
- Disclaimer: "Donations at own risk; no guarantees."

### 6. LEGAL FRAMING
Position as **"donations to support AI projects"** (Kickstarter-style)
- NO equity
- NO promised returns
- NO profit sharing

**Page disclaimer:**
> "This is not an investment. Donations are voluntary contributions to support AI agent development. No returns, equity, or profit sharing is offered or implied. Donate at your own risk."

### 7. SUCCESS METRICS
| Metric | Target | Timeframe |
|--------|--------|-----------|
| Submissions | 5/month | First month |
| Funds raised | $1K+ total | First month |
| Page views | Track via GA | Ongoing |
| Agent feedback | Collect emails | Ongoing |
| Repeat submissions | Any | Signal of trust |

**Review:** After 1 month, decide on v2 features (crypto, DAO, etc.)

---

## VERDICT

**Build the simplest possible version TODAY:**
- Static pages + Google Forms + Stripe donations
- Founder curation for trust
- Donation framing for legal safety
- Manual everything (no backend needed)

**Phase 2 (after validation):**
- Crypto wallet integration
- Gnosis Safe multisig for escrow
- Snapshot voting for community governance

**Council Grade: A** (Practical, actionable, legally safe)
