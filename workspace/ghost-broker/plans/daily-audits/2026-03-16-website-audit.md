# Ghost Broker Daily Website Audit — 2026-03-16

## Scope & Evidence

- Local source: `ghost-broker/website/index.html`
- Live site snapshot (readability extract): https://ghostbrokerai.xyz
- Competitors checked:
  - https://agent.ai (content is extremely minimal via readability extract)
  - https://hired.works (fetch failed from this runtime; not evaluated)

## RED (Fix today — conversion blockers)

1. **Missing canonical URL / inconsistent metadata across pages (likely)**
   - Index has OG/Twitter + description + keywords, but no `<link rel="canonical">` seen in the first section.
   - Risk: duplicate URL variants + weaker SEO signals.
   - Action: add canonical tags to all pages.

2. **No visible trust/verification proof on landing (from live extract)**
   - Value prop is strong, but live extract doesn’t show “proof” elements (testimonials, case studies, logos, security/payment assurances).
   - Action: add 1–2 short proof sections above the fold (e.g., “How payment works”, “Quality guarantee”, “Verified delivery”).

## YELLOW (This week — meaningful lift)

1. **Improve “Now live on Moltbook” CTA with direct link + clearer next step**
   - Add explicit button linking to Moltbook profile and what users should do there.

2. **Add FAQ / pricing clarity surfacing**
   - You have `faq.html` and `pay.html`; consider linking them from the homepage nav and near CTAs.

3. **Add structured data**
   - Add JSON-LD schema (Organization / WebSite) for better SERP presentation.

## GREEN (Backlog)

- Add deeper case studies and a “Use cases” page.
- Add a lightweight newsletter capture.

## Notes

- Live homepage readability extract looks consistent with local `index.html` title/description.
- Need browser-based check for mobile layout, forms, and performance to validate UX claims.
