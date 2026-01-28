# MEMORY.md — Long-Term Memory

*Last updated: 2026-01-27*

## Who I Am
- Bot for Francisco Suels Ferro, running on his Windows 10 PC in Naples, FL
- Claude Opus 4.5 via Clawdbot (2026.1.24-3)
- Channels: Telegram (primary), WhatsApp (backup)
- First boot: January 26, 2026

## Francisco's Core Need
He wants a **business partner**, not just a question-answerer. Someone proactive who brings ideas, anticipates problems, and takes action. He's a soloentrepreneur doing everything alone — I'm his first real teammate. [source: memory/2026-01-26.md] [verified: 2026-01-27]

### Operating Mandate
**Expert-quality strategy and execution on every platform. Highest income, lowest cost.** Not just "fix things" — run each channel like a paid specialist would. Apply rigor, data-driven decisions, and best practices across the board. [source: memory/2026-01-27.md] [verified: 2026-01-27]

## Active Project: Dress Like Mommy (dresslikemommy.com)
- Shopify store — mommy & me matching outfits, dropship via BuckyDrop from China
- Peak: ~$100K/year during pandemic, dropped to ~$15K/year (lost focus to crypto)
- Markets: USA (primary), UK, Canada, Australia
- **Google Merchant Center: SUSPENDED** — misrepresentation review in progress (requested Jan 26). Root cause: 47 countries had ZERO shipping policies. Fixed Jan 27: created "International Standard Shipping" for all 48 countries. Logos replaced (under review 5-7 days). [verified: 2026-01-27]
- **Google Ads: ALL 16 conversions dead** — Shopify G&Y app connected but conversion measurement never added. Francisco needs to click "Add" button in G&Y Settings. Account: 399-097-6848. [verified: 2026-01-27]
- **Microsoft UET: FIXED** — "Purchases" goal switched from old tag (36000629) to ShopifyImport (36005151). 4/5 goals now on correct tag. Smart goal auto-managed. [verified: 2026-01-27]
- **TikTok & Pinterest pixels: NOT WORKING** — connected but not firing
- Facebook Pixel working ✅
- Google Analytics GA4 working ✅ — property G-N4EQNK0MMB (330266838)
- **Product data is a mess:** 157/340 products have Chinese supplier URLs as tags, 101 have empty product_type, 100% of images have no alt text, 49 have alicdn images in descriptions. Cleanup script ready (`scripts/cleanup_products.py`), needs Shopify Admin API token. [verified: 2026-01-27]
- 78 broken product redirects mapped and ready to implement
- Multiple policy pages drafted (About, Contact, Refund, Shipping)
- Logo refresh completed (square + rectangular variants)
- Site has CSS 404 error on combined CSS file
- **BuckyDrop:** Free plan, 221 products sourced, 150 pushed to Shopify, 71 unpushed (intentionally — not mommy-and-me), 375 orders dispatched lifetime. 6 overdue shipments as of Jan 27. Francisco's workflow: source → edit titles/descriptions/pricing → push to Shopify. Support contact: **Scott Buckydrop** (+86 158 2758 0519, WhatsApp). [verified: 2026-01-27]

## What Needs To Happen (DLM Priority Order)
1. Fix Google Merchant Center suspension (biggest revenue blocker)
2. Fix Google Ads conversion tracking (all 16 dead)
3. ~~Fix Microsoft UET double-firing~~ ✅ DONE — Purchases goal switched to ShopifyImport tag
4. Fix TikTok & Pinterest pixel integration
5. Implement 78 product redirects
6. Upload new policy pages
7. Upload new logos
8. Full marketing strategy with 23 frameworks (marketing-mode skill)

## My Capabilities
- 9 ClawdHub skills: marketing, research, humanizer, tweet-writer, reddit, youtube, self-improvement, docs, prompt-engineering
- Web fetch (no search yet — needs Brave API key)
- Gemini CLI for alternative AI research
- Python 3.13 + uv for scripting and image gen
- Full shell access on Francisco's Windows PC
- Browser automation available

## Missing Capabilities (Needs Francisco's Action)
- **Brave Search API key** — CRITICAL, free, unlocks web_search
- **Gemini API key** — enables image generation
- **GitHub CLI** — optional, for code repo management

## Security Posture
- Gateway: loopback only, token auth ✅
- Channels: allowlist/pairing only ✅
- File permissions: locked via icacls ✅
- Log redaction: enabled ✅
- Prompt injection defenses: in SOUL.md ✅
- Model: Opus 4.5 (most injection-resistant) ✅

## Key Lessons Learned
- Windows uses icacls not chmod (audit shows false positives)
- PowerShell: use `;` not `&&`, use `curl.exe` not `curl`
- ClawdHub search frequently times out — use broad queries
- Less is more with AI tools (per Clawdbot creator @steipete)
- Context is precious — don't waste it on unnecessary tools

## Francisco's Values
- Self-reliant, does everything himself
- Resilient — bounced back from Amazon and crypto setbacks
- Believes in AI and technology
- Wants to stay on the cutting edge
- **Values open source** — prefers open tools, open protocols, community-driven projects over closed/proprietary
- Open-minded about pivoting
- Family man — wife Karina (dentist), daughters Giselle (13) and Amanda (9)

## Decision Framework (Tool/Service Selection)
When choosing tools, services, or platforms, prefer:
1. Open source over proprietary
2. Free/community tier over paid when quality is comparable
3. Self-hosted over SaaS when practical
4. Open protocols over walled gardens
5. Transparent pricing over hidden costs

## Changelog
| Date | What Changed | Why |
|------|-------------|-----|
| 2026-01-27 | Added Changelog section; retroactive — all prior content predates this rule | Francisco established memory integrity rules: source refs, verification dates, no silent overwrites, changelog tracking [source: webchat directive] |
| 2026-01-27 | Added Operating Mandate under Core Need | Francisco directive: expert-quality strategy on every platform, highest income / lowest cost [source: memory/2026-01-27.md] |
| 2026-01-27 | Updated DLM project status with detailed platform fixes | GMC shipping fixed, logos under review, Google Ads root cause found, product data audit completed, BuckyDrop studied [source: memory/2026-01-27.md] |
| 2026-01-27 | Added BuckyDrop support contact + workflow notes | Scott Buckydrop (+86 158 2758 0519 WhatsApp), Francisco's product workflow: source→edit→push, 71 unpushed are intentional [source: memory/2026-01-27.md] |
| 2026-01-27 | Fixed Microsoft Ads UET — Purchases goal tag | Changed from old dresslikemommy.com (36000629) to ShopifyImport (36005151). 4/5 goals now correct. [source: memory/2026-01-27.md] |
