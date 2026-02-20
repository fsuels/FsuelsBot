# Project Memory

> Updated: 2026-02-20
> Retrieval tags: 123LegalDoc, Mission Control, FsuelsBot, DressLikeMommy, DLM, deploy, memory

## 123LegalDoc

- Stripe webhook + Firebase setup completed (early sessions, ~Feb 2026)
- Repository set to private per user request
- Had canonical SEO/deploy conflict with SSR function update lock and web.app canonical leakage

## Mission Control

- URL: http://localhost:8765/ (separate from OpenClaw gateway at :18789)
- Source: `workspace/mission-control/index.html` (single HTML file + Python server)
- User requested full task/cron reset and delete functionality fixes
- Cron delete/count behavior was patched; UI count shows zero
- Task card UI improvement is queued

## FsuelsBot

- Main failure mode: robotic/status-heavy replies instead of direct answers
- Family trigger recall repeatedly failed until explicit user-provided facts were pinned (2026-02-20)
- Memory consolidation done 2026-02-20: eliminated duplicate files, fixed trigger map

## DressLikeMommy (DLM)

- 12-listing workflow uses strict freshness gate with visible listing-date proof
- Pomelli AI photoshoot task is blocked waiting on: image folder, Shopify access, product list
