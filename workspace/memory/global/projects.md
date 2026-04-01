# Project Memory

> Updated: 2026-03-31
> Retrieval tags: 123LegalDoc, Mission Control, FsuelsBot, DressLikeMommy, DLM, deploy, memory

## 123LegalDoc

- Stripe webhook + Firebase setup completed (early sessions, ~Feb 2026)
- Repository set to private per user request
- Had canonical SEO/deploy conflict with SSR function update lock and web.app canonical leakage

## Mission Control

- URL: http://localhost:18789 (served by OpenClaw gateway)
- Mobile: http://192.168.7.50:18789
- Note: Previously ran on port 8765 via separate Python server (Windows era); now integrated into gateway
- User requested full task/cron reset and delete functionality fixes
- Cron delete/count behavior was patched; UI count shows zero
- Task card UI improvement is queued

## FsuelsBot

- Main failure mode: robotic/status-heavy replies instead of direct answers
- Family trigger recall repeatedly failed until explicit user-provided facts were pinned (2026-02-20)
- Memory consolidation done 2026-02-20: eliminated duplicate files, fixed trigger map
- Canonical repo path confirmed by user context: `/Users/fsuels/Projects/FsuelsBot`
- Plan Mode default enforced for code/architecture/multi-step tasks unless user explicitly says `/auto`, `/task`, or `/explore` (2026-03-31)

## DressLikeMommy (DLM)

- 12-listing workflow uses strict freshness gate with visible listing-date proof
- Pomelli AI photoshoot task is blocked waiting on: image folder, Shopify access, product list
- Durable tracking architecture (2026-03-31): Google & YouTube app is the only Google tracking source on Shopify; GTM must not be used for Google tags.
- Measurement rule (2026-03-31): GA4 purchase value should equal subtotal only (exclude shipping and tax).
- Ads rule (2026-03-31): Optimize on product revenue (not gross) and keep exactly one Primary purchase conversion in Google Ads.
- Validation workflow (2026-03-31): reconcile transaction_id across Shopify, GA4, and Google Ads; do not persist order/revenue/conversion totals as durable memory facts.
- Execution ownership (2026-03-31): FsuelsBot is expected to execute implementation of the active DLM plan directly and escalate only true blockers.
- Canonical project path confirmed by user: `fuels/projects/dresslikemommy`.
- Hard boundary rule: DLM and FsuelsBot are separate codebases; never mix code, paths, or changes across projects.
