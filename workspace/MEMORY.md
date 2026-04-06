# MEMORY.md — Operational Facts

_Last reviewed: 2026-04-05_

## Mission Control

- **Local:** http://localhost:18789
- **Mobile:** http://192.168.7.50:18789
- Open Chrome to Mission Control on every gateway start. Report both URLs.

## Runtime

- **Hardware:** Mac Mini M4, Naples FL (migrated from Windows 10 in Feb 2026)
- **First boot:** January 26, 2026
- **Repo:** github.com/fsuels/FsuelsBot (fork of openclaw/openclaw)
- **Channels:** Telegram (primary), WhatsApp (backup)
- **Model preference:** Francisco wants the latest available OpenAI model in runtime; he explicitly requested `openai 5.4` and approved update attempts to enable newest model support (2026-03-27).

## User Interaction Preferences

- Do **not** provide time-to-complete estimates unless Francisco explicitly asks.
- Operate autonomously on this computer without routine user help; interrupt only for true hard blockers (2FA/captcha/high-impact approval).
- Mission Control task cards must be audit-friendly and show: exact user request text, explicit agent understanding, concrete steps completed, and supporting evidence.
- Send Mission Control/access URLs as plain, directly clickable links (no clutter/format wrappers), optimized for phone opening from Telegram.
- Mission Control mobile links must open directly on phone browsers without 403 errors and be easy to save/reopen later.
- After gateway/restarts, proactively send the current mobile Mission Control access link immediately.
- For any web/browser task, always use Google Chrome profile **test** (Profile 1) so saved site logins are available.
- Apply the established plan-review format by default for all plan reviews unless Francisco explicitly asks for a different format.
- Keep browser tab usage disciplined and organized; avoid opening excessive tabs.
- Keep explanations simple and easy to understand; avoid confusing technical wording when reporting blockers/issues.
- When presenting options, always include a clear recommendation and the reason.
- Before changing code, first understand the current code and implications; do not break what already works; verify edits produce the intended result.
- Treat **FsuelsBot** and **DressLikeMommy** as separate projects with separate codebases; never mix code, paths, or changes between them.
- For **dresslikemommy.com** changes, use the DressLikeMommy project codebase (user-provided path string: `fsuels/projects/dresslikemommy`).
- When an older important instruction conflicts with a newer instruction in the same decision scope, follow the newer instruction unless it violates a hard rule.
- Family/relationship memory is high-priority and should not be dropped casually.
- Maintain an aggressive, outcome-focused execution posture tied to measurable profit goals.

## Active Business: Dress Like Mommy (dresslikemommy.com)

Shopify store — mommy & me matching outfits, dropship via BuckyDrop from China.
Markets: USA (primary); UK/CA/AU secondary.
Peak: ~$100K/yr (pandemic); dropped to ~$15K/yr after focus shift to crypto.

### Platform Status (verify before acting)

- GMC: SUSPENDED — misrepresentation review
- Google Ads: conversions not implemented (Account 399-097-6848)
- Microsoft Ads UET: mostly correct (Purchases goal fixed 2026-01-27)
- TikTok/Pinterest: connected but not firing
- Facebook Pixel: working
- GA4: working (G-N4EQNK0MMB, property 330266838)

### Product Data Issues

- 157/340 products have Chinese supplier URLs as tags
- 101 have empty product_type
- 100% of images have no alt text
- 49 have alicdn images in descriptions
- 78 broken product redirects mapped and ready
- BuckyDrop: 221 products sourced, 150 pushed, 71 intentionally unpushed
- BuckyDrop support: Scott Buckydrop (WhatsApp — treat as sensitive)

## Tools Built

- **Mission Control** — Interactive dashboard (http://localhost:18789). Task management, team view, status.
- **The Council** — Multi-AI debate system: Grok, ChatGPT, Gemini → Opus synthesis. $0 extra.
- **Activity Monitor** — Python backend tails logs, serves real-time activity JSON.
- **SEO Scripts** — Product audit, cleanup, optimizer. Need Shopify Admin API token.

## AI Budget

- Claude Max $100/mo (flat) — Opus + Sonnet unlimited.
- X/Grok — included in X subscription (browser only)
- ChatGPT Pro — flat sub (browser only)
- Open Arena — free (browser only)
- Gemini CLI — free (Google OAuth, terminal)

## Revenue Target

- **Performance floor:** Minimum $500 net profit/week across all agents (set 2026-02-18)
- Tracking: 7/14/30-day windows; expectation is to exceed baseline

## DLM Sourcing Rules

- **1688 freshness gate:** Product listings must be created this year (2026). Visible listing-creation date required as proof.
- **Vendor criteria:** Must match mom-and-baby style/product criteria.

## Key Technical Notes

- **Large sessions crash** (118K+ tokens) → Keep sessions compact, use /compact
- Gateway launchd: `~/Library/LaunchAgents/bot.molt.gateway.plist`
- Session state: `~/.clawdbot/agents/main/sessions/sessions.json`
- Config: `~/.clawdbot/moltbot.json`
- LM Studio at `http://127.0.0.1:1234/v1` (use IPv4, NOT localhost)
- Mac Mini M4 limited RAM — one large LM Studio model at a time
