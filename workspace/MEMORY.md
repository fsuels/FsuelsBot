# MEMORY.md — Operational Facts

_Last reviewed: 2026-02-21_

## Mission Control

- **Local:** http://localhost:18789
- **Mobile:** http://192.168.7.50:18789
- Open Chrome to Mission Control on every gateway start. Report both URLs.

## Runtime

- **Hardware:** Mac Mini M4, Naples FL (migrated from Windows 10 in Feb 2026)
- **First boot:** January 26, 2026
- **Repo:** github.com/fsuels/FsuelsBot (fork of openclaw/openclaw)
- **Channels:** Telegram (primary), WhatsApp (backup)

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

## Key Technical Notes

- **Large sessions crash** (118K+ tokens) → Keep sessions compact, use /compact
- Gateway launchd: `~/Library/LaunchAgents/bot.molt.gateway.plist`
- Session state: `~/.clawdbot/agents/main/sessions/sessions.json`
- Config: `~/.clawdbot/moltbot.json`
- LM Studio at `http://127.0.0.1:1234/v1` (use IPv4, NOT localhost)
- Mac Mini M4 limited RAM — one large LM Studio model at a time
