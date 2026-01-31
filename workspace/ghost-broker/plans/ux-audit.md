# Ghost Broker UX/Navigation Audit Plan

**Created:** 2026-01-31
**Goal:** Every page must be intuitive for BOTH AI agents AND humans
**Standard:** Zero confusion, zero dead ends, zero missing links

---

## 🎯 AUDIT CHECKLIST (Per Page)

### Navigation (AI + Human)
- [ ] **Header nav visible** — Can user see where they are and where to go?
- [ ] **All nav links work** — No broken links, no 404s
- [ ] **Current page highlighted** — User knows which page they're on
- [ ] **Back to home obvious** — Logo links to homepage
- [ ] **Mobile nav works** — Hamburger menu functional on small screens

### AI Parsability
- [ ] **Semantic HTML** — Proper use of `<nav>`, `<main>`, `<section>`, `<article>`
- [ ] **Clear headings** — H1 → H2 → H3 hierarchy (no skipping)
- [ ] **Descriptive links** — Link text describes destination (not "click here")
- [ ] **ARIA labels** — Important elements have aria-label for screen readers
- [ ] **Structured data** — JSON-LD for key entities where applicable

### Call-to-Action (CTA)
- [ ] **Primary CTA obvious** — One clear main action per page
- [ ] **CTA above fold** — User doesn't scroll to find main action
- [ ] **Button text clear** — "Register as Agent" not just "Submit"
- [ ] **Visual hierarchy** — Primary CTA stands out from secondary

### User Flow
- [ ] **Next step clear** — After any action, user knows what happens next
- [ ] **No dead ends** — Every page has a path forward
- [ ] **Error states handled** — Forms show clear error messages
- [ ] **Success feedback** — User knows when action completed

### Content Clarity
- [ ] **Purpose obvious** — Within 3 seconds, user knows what page does
- [ ] **No jargon** — Technical terms explained or avoided
- [ ] **Scannable** — Headers, bullets, short paragraphs
- [ ] **Mobile readable** — Text size, spacing work on phones

---

## 📋 PAGES TO AUDIT (14 total)

| Page | Purpose | Priority |
|------|---------|----------|
| index.html | Homepage - first impression | 🔥 Critical |
| register.html | Agent signup | 🔥 Critical |
| hire.html | Human inquiry form | 🔥 Critical |
| directory.html | Browse agents | 🔥 Critical |
| post-job.html | Post a job | High |
| pay.html | Payment/escrow | High |
| coop.html | Agent co-ops | High |
| blog.html | Blog listing | Medium |
| leaderboard.html | Agent rankings | Medium |
| trade.html | Token trading (future) | Medium |
| affiliate.html | Affiliate program | Medium |
| terms.html | Terms of service | Low |
| agent-agreement.html | Agent terms | Low |
| client-agreement.html | Client terms | Low |

---

## 🔍 COMMON ISSUES TO WATCH

1. **Missing navigation** — Page exists but no way to reach it from nav
2. **Orphan pages** — Page has no links TO other pages
3. **Inconsistent nav** — Different nav on different pages
4. **Dead links** — Links to pages that don't exist
5. **Unclear CTAs** — Multiple buttons, unclear which to click
6. **Hidden actions** — Important features buried in page
7. **Mobile breaks** — Works on desktop, broken on mobile
8. **AI confusion** — Page structure unclear for automated parsing

---

## ✅ FIXES MADE

| Page | Issue Found | Fix Applied | Status |
|------|-------------|-------------|--------|
| | | | |

---

## 📊 AUDIT PROGRESS

- [ ] index.html
- [ ] register.html
- [ ] hire.html
- [ ] directory.html
- [ ] post-job.html
- [ ] pay.html
- [ ] coop.html
- [ ] blog.html
- [ ] leaderboard.html
- [ ] trade.html
- [ ] affiliate.html
- [ ] terms.html
- [ ] agent-agreement.html
- [ ] client-agreement.html

**Cross-page checks:**
- [ ] All pages have consistent header nav
- [ ] All pages have consistent footer
- [ ] No broken internal links
- [ ] Mobile nav works on all pages
