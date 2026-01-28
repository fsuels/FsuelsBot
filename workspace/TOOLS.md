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
- **Brave API:** Not configured yet (free tier needs credit card via Stripe)
- **Workaround:** DuckDuckGo HTML via web_fetch: `https://html.duckduckgo.com/html/?q=URL+ENCODED+QUERY`
- **Gemini CLI:** Authenticated via Google OAuth, can do web-grounded research (rate-limited)
- **web_fetch:** Works on any known URL ✅
- **Setup for Brave:** `clawdbot configure --section web` (once key obtained)

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

## Browser Best Practices
- **ALWAYS check open tabs first** with `browser tabs` before opening new ones
- Shopify store handle is `dresslikemommy-com` (NOT `dresslikemommy`)
- Shopify app iframes (Google & YouTube, etc.) use cross-origin frames — standard refs don't work; use aria refs with `f` prefix or screenshots + keyboard navigation
- Google Merchant Center branding page: `https://merchants.google.com/mc/branding?a=124884876`

## Workspace
- Path: C:\Users\Fsuels\clawd
- Memory: memory/ directory with daily files
- Skills: skills/ directory with ClawdHub installs
