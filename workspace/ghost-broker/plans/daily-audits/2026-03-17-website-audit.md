# Ghost Broker AI — Daily Website Audit (2026-03-17)

## Evidence / Sources checked

- Local HTML: `ghost-broker/website/index.html`, `hire.html`, `register.html`, `directory.html`, `faq.html`
- Live site: https://ghostbrokerai.xyz (fetched 2026-03-17)
- Competitors:
  - https://agent.ai (fetched)
  - https://clawhub.ai (fetched)
  - https://hired.works (browser opened but snapshot tool failed; could not reliably extract content)
- GitHub org: https://github.com/GhostBrokerAI (fetched)

---

## RED — Fix TODAY (blocking revenue / SEO / trust)

1. **Live `robots.txt` / `sitemap.xml` appear broken on production**
   - Live `robots.txt` fetch returned Cloudflare-managed robots rules **plus what looks like appended HTML** (homepage content).
   - Live `sitemap.xml` fetch returned **homepage HTML content**, not an XML sitemap.
   - Impact: search engines may ignore indexing signals; SEO can be severely harmed.
   - Local expected files exist and look correct:
     - `ghost-broker/website/robots.txt`
     - `ghost-broker/website/sitemap.xml`

2. **Waitlist form endpoint on homepage likely wrong / inconsistent**
   - `index.html` uses: `https://formspree.io/f/ghostbrokerai@proton.me` (looks like an email, not a Formspree form ID).
   - `hire.html` + `register.html` submit to: `https://formspree.io/f/xpwzgkvr`.
   - Impact: homepage email capture may silently fail.

3. **Trust claim mismatch: “verified agents” vs demo/sample directory**
   - `directory.html` says: “verified AI agents” + stats like “Jobs Completed / Avg Rating”.
   - Page is hard-coded sample data + no real verification process described.
   - Impact: credibility risk (users feel misled).

---

## YELLOW — This week (meaningful conversion improvement)

1. **Make value prop more concrete above the fold**
   - Current hero is strong branding (“economic infrastructure for the agent economy”) but doesn’t instantly answer:
     - _What do I get today?_ (deliverable examples)
     - _How fast?_ (typical turnaround)
     - _How do you guarantee quality?_ (process, revisions, escrow/dispute)
   - Recommendation: add 3 concrete example “packages” (e.g., “Local SEO: 20 citations + GBP audit”, “Competitor brief”, “Automation setup”) with price ranges.

2. **Add obvious trust signals**
   - Founder/about page, “How verification works”, simple case studies, delivery samples.
   - Add “what happens after you submit” clarity on hire/register pages (timeline + contact expectation).

3. **Normalize meta + OG tags across pages**
   - `index.html` and `faq.html` have OG/Twitter tags.
   - `hire.html`, `register.html`, `directory.html` are missing OG/Twitter tags and canonical.

---

## GREEN — Backlog (nice-to-have)

1. **Structured data (Schema.org)**
   - Add `Organization`, `WebSite`, and FAQ schema on `faq.html`.

2. **Directory SEO**
   - If directory remains JS-rendered, consider a static/SSR version or a minimal server-generated list to be indexable.

3. **Community health dashboard**
   - A small “Community” page with GitHub/Discord/X links + live counts (or at least last-updated timestamps).

---

## Competitor notes (fast scan)

- **agent.ai**: positioning is extremely simple: “professional network for AI agents” + emphasis on _trustworthy agents_. Minimal copy, but “network” framing is clear.
- **clawhub.ai**: very sharp niche: “skill dock” + versioning/rollback + install snippet. It communicates _what it does_ in one screen, and has an obvious dev CTA.

Opportunity for Ghost Broker: we can win on **trust + delivery receipts** (guarantees, escrow, revisions, verification, and clear examples of what clients get).
