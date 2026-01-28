# MEMORY.md — Long-Term Memory

*Last updated: 2026-01-28*

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
- Web search via Brave API ✅ (configured and working)
- Gemini CLI for alternative AI research
- Python 3.13 + uv for scripting and image gen
- Full shell access on Francisco's Windows PC
- Browser automation available

## Missing Capabilities (Needs Francisco's Action)
- ~~**Brave Search API key**~~ ✅ DONE — configured and working [verified: 2026-01-28]
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
- **Large sessions cause crashes** — 118K+ tokens → API timeouts → `TypeError: fetch failed` → process crash. Keep sessions compact. [verified: 2026-01-28]
- **Gateway MUST be installed as service** — `clawdbot gateway install` creates Windows Scheduled Task for auto-restart. Critical for stability. [verified: 2026-01-28]
- **`--unhandled-rejections=warn`** — Add to gateway.cmd Node.js args to prevent crash on fetch failures. Applied but needs gateway restart. [verified: 2026-01-28]
- **NEVER BE IDLE** — Francisco's directive: if tasks exist in Mission Control, I should be working on them proactively. Don't wait for prompts. [verified: 2026-01-28]
- **Activity server needs to proxy** — Gateway is loopback-only, phone can't reach it directly. Activity server on 0.0.0.0:8765 proxies /api/status. [verified: 2026-01-28]

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

## Core Directive from Francisco [verified: 2026-01-27]
**"I want to customize you to the best of your potential. I want to be in the very cutting edge of this technology."**
- This is the #1 priority: FsuelsBot should be the most advanced personal AI agent possible
- Always research, learn, implement the latest AI agent techniques
- Read expert posts AND their comment threads for hidden gems
- Daily 9 AM research briefs with actionable improvement opportunities
- X account (@Cogitolux) is for research + Grok only, never post
- FsuelsBot repo (github.com/fsuels/FsuelsBot) = engine + brain, single source of truth
- Francisco is the architect. I am the living project. We build together.
[source: Telegram conversation 2026-01-27 ~11PM EST]

## Core Principle — The Compound Loop
[source: direct conversation] [verified: 2026-01-28]

Francisco's north star for this AI system: **Grow stronger and more capable each day.**

The loop:
1. **Council** — best ideas from multiple AIs debating
2. **Execute** — actually do the work, not just talk
3. **Remember** — every task, decision, outcome, lesson
4. **Learn** — memory feeds better decisions tomorrow
5. **Improve overnight** — build something better while he sleeps
6. **Repeat** — every cycle makes the next one smarter

The system that improves itself is worth infinitely more than the system that just follows orders. Memory is the flywheel. Without it, nothing compounds.

## Digital Workforce — The Company
[source: Telegram 2026-01-28 02:35-02:48 EST] [verified: 2026-01-28]

Francisco's vision: **Each skill = a digital employee.** The system is a company.
- I (Fsuels Bot) am the CEO/orchestrator — I delegate to specialists
- Every skill file maps to a team member with name, role, avatar, model
- Team roster stored in `mission-control/team.json` (8 specialists + me)
- Activity tab renamed "Team" — shows digital workforce grid as default landing
- When sub-agents spawn, their matching team card lights up
- Inspired by Twin.so (AI company builder) — Hugo Mercier, $10M seed, 147K agents deployed

### Twin.so Research (2026-01-28)
- @twin_labs on X — only 2 posts, 3K followers. CEO @hugomercierooo is the real account (8.9K followers)
- Launched publicly Jan 27, 2026 — 1.3M views on launch post
- Key features we can learn from: worker cards, live execution view, chat-first builder, schedule manager, memory explorer, live stat counters
- They're cloud SaaS ($10M funded). We're local, free, on Francisco's own machine. Different approach, same vision.

## Tools Built
- **Mission Control** — `mission-control/index.html` + `data.json`. Interactive dashboard: Team (default), Kanban, Brain, Summary views. Multi-project filter (DLM/Agent). Served on port 8765. [verified: 2026-01-28]
- **Digital Workforce Grid** — `mission-control/team.json`. 8 specialist cards with avatars, roles, models, capabilities, task counts. Twin.so-inspired worker cards. [verified: 2026-01-28]
- **Activity Monitor** — `mission-control/activity-server.py`. Python backend tails Clawdbot logs, serves real-time activity JSON. Shows status (working/thinking/idle), current task, tool calls, errors. [verified: 2026-01-28]
- **Current Task Tracker** — `mission-control/current-task.json`. Written by Clawd when starting tasks. Dashboard displays task ID, project, title, progress. [verified: 2026-01-28]
- **The Council** — `skills/council/SKILL.md`. Multi-AI debate system: Grok, ChatGPT, Gemini, Open Arena → Opus 4.5 synthesis. 3 modes. $0 extra. [verified: 2026-01-28]
- **Overnight Build System** — 2 AM cron job. Reviews day, picks ONE improvement, builds it, commits to git. Reports in `overnight-builds/YYYY-MM-DD.md`. [verified: 2026-01-28]
- **SEO Scripts** — `scripts/audit_products.py`, `cleanup_products.py`, `seo_optimizer.py`. Ready but need Shopify API key (MC-027). [verified: 2026-01-28]
- **Watchdog** — `scripts/clawdbot-watchdog.ps1`. Backup crash recovery monitor. [verified: 2026-01-28]

## AI Budget Rules [verified: 2026-01-28]
- Claude Max $100/mo (flat) — runs Clawdbot. Opus 4.5 + Sonnet unlimited.
- X/Grok — included in X sub. Browser access only.
- ChatGPT Pro — flat sub. Browser access only.
- Open Arena — free. Browser access only.
- Gemini CLI — free. Terminal access.
- **$0 extra allowed.** Never add paid services without explicit approval.
[source: memory/2026-01-27.md]

## Changelog
| Date | What Changed | Why |
|------|-------------|-----|
| 2026-01-27 | Added Changelog section; retroactive — all prior content predates this rule | Francisco established memory integrity rules: source refs, verification dates, no silent overwrites, changelog tracking [source: webchat directive] |
| 2026-01-27 | Added Operating Mandate under Core Need | Francisco directive: expert-quality strategy on every platform, highest income / lowest cost [source: memory/2026-01-27.md] |
| 2026-01-27 | Updated DLM project status with detailed platform fixes | GMC shipping fixed, logos under review, Google Ads root cause found, product data audit completed, BuckyDrop studied [source: memory/2026-01-27.md] |
| 2026-01-27 | Added BuckyDrop support contact + workflow notes | Scott Buckydrop (+86 158 2758 0519 WhatsApp), Francisco's product workflow: source→edit→push, 71 unpushed are intentional [source: memory/2026-01-27.md] |
| 2026-01-27 | Fixed Microsoft Ads UET — Purchases goal tag | Changed from old dresslikemommy.com (36000629) to ShopifyImport (36005151). 4/5 goals now correct. [source: memory/2026-01-27.md] |
| 2026-01-28 | Added Tools Built section | Mission Control, Activity Monitor, Council, Overnight Build, SEO Scripts, Watchdog documented [source: memory/2026-01-28.md] |
| 2026-01-28 | Added AI Budget Rules | $0 extra rule, all subscription details [source: memory/2026-01-27.md late session] |
| 2026-01-28 | Added crash prevention lessons | Large sessions, gateway service, unhandled-rejections flag, proxy pattern [source: memory/2026-01-28.md] |
| 2026-01-28 | Added NEVER BE IDLE directive | Francisco's proactivity mandate [source: Telegram 2026-01-28 00:54 EST] |
| 2026-01-28 | Added Digital Workforce section | Twin.so research, team.json roster, Activity→Team view redesign [source: Telegram 2026-01-28 02:35 EST] |
| 2026-01-28 | Council overnight session launched | Full Feedback Loop: memory, task completion, self-improvement architecture [source: Telegram 2026-01-28 02:48 EST] |
