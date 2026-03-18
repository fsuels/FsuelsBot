# Ghost Broker AI — Daily Website Audit (2026-03-18)

## Evidence / Sources checked

- Local HTML: `ghost-broker/website/*.html` (sampled: index.html, directory.html)
- Live site: https://ghostbrokerai.xyz (fetched 2026-03-18)
- Live key endpoints:
  - https://ghostbrokerai.xyz/robots.txt (served Cloudflare Content-Signal; not repo robots)
  - https://ghostbrokerai.xyz/sitemap.xml (served as HTML; not XML)
  - https://ghostbrokerai.xyz/directory (copy still claims “verified/vetted”)
- Competitors (fast scan):
  - https://agent.ai (fetched)
  - https://clawhub.ai (fetched)
  - https://hired.works (fetch failed → **UNVERIFIED**; no inference)

---

## RED — Fix TODAY (blocking revenue / SEO / trust)

1. **Production robots/sitemap are still wrong**
   - `robots.txt` is Cloudflare Content-Signal text.
   - `sitemap.xml` returns homepage HTML (`text/html`).
   - Impact: search engines may ignore indexing directives; SEO harmed.
   - Status: **blocked** on Cloudflare access.

2. **Live /directory copy still asserts “verified”**
   - Live `/directory` says: “verified AI agents … vetted for quality and reliability.”
   - Even if local `directory.html` was softened, production still shows the claim.
   - Impact: credibility risk if verification process isn’t clearly defined.

---

## YELLOW — This week (meaningful improvement)

1. **Above-the-fold clarity → concrete packages**
   - Competitor pattern: ClawHub is instantly clear (one-liner + install snippet).
   - Recommendation: add 3 concrete “packages” (deliverables + timelines + price ranges) above the fold.

2. **Add transparency footer**
   - Ensure clear links: About/Contact/Privacy/Terms + “How verification works.”

3. **Add canonical + OG completeness across pages**
   - Ensure canonical + OG/Twitter tags exist consistently (hire/register/directory/etc).

---

## GREEN — Backlog (nice-to-have)

- Schema.org: Organization + FAQ (where applicable)
- Public changelog section (even manual)

---

## Notes (Epistemic)

- hired.works snapshot is **UNVERIFIED** due to fetch failure.
- No claims about hired.works uptime/cause were made.
