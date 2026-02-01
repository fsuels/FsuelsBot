# TOOLS.md - Local Notes

## Environment
- **OS:** Windows 10 (x64), DESKTOP-O6IL62J
- **Python:** 3.13 at C:\Python313\python.exe
- **uv:** 0.9.27 at C:\Python313\Scripts\uv.exe
- **Git:** C:\Program Files\Git\cmd\git.exe
- **Gemini CLI:** 0.1.1 (npm global)
- **Node.js:** v22.14.0

## Important Windows Notes
- Use `curl.exe` (not `curl`) — PowerShell aliases `curl` to `Invoke-WebRequest`
- Use `Select-Object -First N` instead of `head -N`
- File permissions: use `icacls` not `chmod`
- Paths use backslashes but most tools accept forward slashes too

## Web Search
- **Brave API:** Configured and working ✅ (key provided by Francisco Jan 27, 2026)
- **web_search:** Full Brave Search API access — titles, URLs, snippets
- **web_fetch:** Works on any known URL ✅
- **Gemini CLI:** Authenticated via Google OAuth, can do web-grounded research (rate-limited)

## Weather
- Service: wttr.in (no API key needed)
- Command: `curl.exe -s "wttr.in/Naples+FL?format=3"`
- Location: Naples, FL 34119

## Channels
- **Telegram:** Active, bot token configured, DM pairing mode
- **WhatsApp:** Active, allowlist mode (Francisco's number only)

## Security
- Gateway: loopback only, token auth
- File permissions: restricted via icacls (Fsuels/SYSTEM/Admins only)
- Logging: redactSensitive = "tools"
- Prompt injection defenses in SOUL.md

## Skills Configuration
- All 9 ClawdHub skills installed in workspace/skills/
- Bundled skills auto-loaded from npm package
- Skills refresh on next session start

## TTS / Voice
- Not configured yet (no ElevenLabs/sag skill)

## Image Generation
- nano-banana-pro available (bundled) but needs GEMINI_API_KEY
- uv installed ✅

## WhatsApp Communication Workflow
- **I CANNOT control WhatsApp desktop app** — only web browsers
- When Francisco needs to message someone on WhatsApp (e.g. BuckyDrop support):
  1. Draft the message
  2. Send it in Telegram chat (plain text, ready to copy)
  3. Francisco copies from Telegram on mobile → pastes into WhatsApp
- **BuckyDrop support:** Scott Buckydrop (+86 158 2758 0519)
- ALWAYS put the message in Telegram for copy/paste — never ask Francisco to type it himself

## Face Swaps
- **Faces folder:** C:\Users\Fsuels\Downloads\faces
- **Website:** https://aifaceswap.io/#face-swap-playground

## Browser Best Practices
⚠️ **MANDATORY: Read `procedures/browser.md` before ANY browser action!**

### 🎯 ALWAYS KEEP OPEN (Non-negotiable)
- **Tab 1: Mission Control** — http://localhost:8765 — NEVER close this tab

### Speed Reality Check (Learned 2026-01-29)
**Bot is SLOWER than human for visual/browser tasks.**
- Bot: screenshot → process → action → wait → repeat = 5-15 sec/step
- Human: look → click = 1 second
- **For quick edits and visual navigation, prepare content/instructions and let human execute**
- Bot should focus on: research, writing, data, background work, memory

Quick rules (full details in procedure file):
- **ONE TAB PER DOMAIN** — 1 Shopify, 1 BuckyDrop, 1 1688. NEVER 2+ tabs of same site.
- **ALWAYS `browser tabs` FIRST** — check what's open before ANY action
- **NAVIGATE within the tab** — don't open new tab, use the existing one
- **CLOSE immediately when done** — never leave mess
- **MAX 3-4 tabs total** — keep it minimal

Site-specific notes:
- Shopify store handle is `dresslikemommy-com` (NOT `dresslikemommy`)
- Shopify app iframes (Google & YouTube, etc.) use cross-origin frames — standard refs don't work; use aria refs with `f` prefix or screenshots + keyboard navigation
- Google Merchant Center branding page: `https://merchants.google.com/mc/branding?a=124884876`

## X (Twitter) Account
- **Handle:** @Cogitolux
- **Display name:** CogitoLux
- **This is Francisco's PERSONAL account**
- **Access:** Browser automation via clawd profile (logged in)
- **ONLY TWO uses:**
  1. **Research** — read feeds, track experts, find AI news
  2. **Grok** — use X's built-in AI for queries
- **NEVER:** post, reply, like, retweet, DM, or interact publicly
- **Can follow** new accounts when Francisco approves
- **Daily research brief:** 9 AM EST via cron job — AI agents, Moltbot, Claude news

## GitHub Repository
- **Repo:** github.com/fsuels/FsuelsBot (private, fork of moltbot/moltbot)
- **Local path:** C:\dev\FsuelsBot (engine + workspace)
- **Old workspace backup:** github.com/fsuels/fsuels-workspace-backup (can be deleted)
- **Daily auto-commit:** 11 PM EST via cron job
- **gh CLI:** C:\Program Files\GitHub CLI\gh.exe (installed but not authenticated)

## Workspace
- Path: C:\dev\FsuelsBot\workspace
- Repo root: C:\dev\FsuelsBot
- Memory: memory/ directory with daily files
- Skills: skills/ directory with ClawdHub installs

## AI Subscriptions (Fixed Budget — $0 extra allowed)
- **Claude Max** — $100/month flat. Opus 4.5 + Sonnet unlimited. Runs Clawdbot.
- **X / Grok** — Included in X subscription. Grok 4.1 Thinking via browser.
- **ChatGPT Pro** — Flat subscription. ChatGPT 5.2 + GPTs via browser.
- **Open Arena** — Free. Open-source models via browser.
- **Gemini CLI** — Free. Google OAuth authenticated. Terminal access.
- **RULE:** Never add any paid service/API without Francisco's explicit approval.

## The Council (Multi-AI System)
- Skill: `skills/council/SKILL.md`
- Sessions saved: `council-sessions/`
- Trigger: "Council: [question]"
- Modes: Standard, Inner Critic, Feedback Loop (multi-round)
- Architecture: Sonnet orchestrates → free AIs think → Opus 4.5 delivers final verdict
- Cost per session: $0 extra (all existing subscriptions)
