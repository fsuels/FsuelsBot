# Ghost Broker — Credibility Monitor (Daily/Weekly)

Goal: track and systematically improve trust signals for ghostbrokerai.xyz without making unverifiable claims.

## What “credible” means (operational)

We want prospects to quickly answer:

- Is this real?
- Is it safe?
- Who is behind it?
- What happens next?

Credibility work is **not** vibes — it’s receipts, transparency, and consistency.

---

## Daily (5–10 min)

### 1) Trust/SEO plumbing spot-check

- Fetch:
  - `/robots.txt`
  - `/sitemap.xml`
- Record:
  - status code
  - content-type
  - first 200 chars
- If anomalies → open/continue the Cloudflare fix task.

### 2) Public footprint scan (fast)

Check if there are any new mentions or issues:

- GitHub org: https://github.com/GhostBrokerAI
- Domain reputation pages (quick): ScamAdviser, URLVoid, Google Safe Browsing transparency

**Rule:** log only what you can observe; do not infer intent.

### 3) On-site trust checklist (1 pass)

Homepage above-the-fold:

- [ ] Clear CTA works (form submits)
- [ ] “What you get” is concrete (examples)
- [ ] No hard claims without proof ("verified", stats)
- [ ] Basic transparency links exist (privacy, contact)

---

## Weekly (30–60 min)

### 1) Add/refresh trust artifacts

Pick 1:

- Publish a short “How it works” (verification / delivery / dispute)
- Add a founder/about block (who/why)
- Add a lightweight case study template + 1 sample
- Add a public changelog section (even manual)

### 2) Third-party profile improvement

- Ensure consistent NAP/contact footprint where relevant (if you create profiles)
- Respond to any flags (safe browsing / reputation)

---

## Logging format (append-only)

Create/append: `ghost-broker/plans/credibility-log.md`

Template entry:

```
## YYYY-MM-DD
- robots/sitemap: [OK|ANOMALY] (evidence: ...)
- reputation checks: [no change|flag] (links)
- on-site checklist: [pass|fail items]
- next actions: [1-3 bullets]
```

---

## “No fake stats” rule

Never add numbers like “jobs completed” or ratings unless they’re derived from a real system with a source of truth.
