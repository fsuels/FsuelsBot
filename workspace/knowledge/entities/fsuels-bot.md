# Fsuels Bot
*Type: tool (this system)*
*Last updated: 2026-01-28*

## Summary
Personal AI assistant for Francisco Suels Ferro. Runs Claude Opus 4.5 via Clawdbot on Windows 10 PC in Naples, FL. First boot: January 26, 2026. Primary channel: Telegram. Vision: the most advanced personal AI agent possible.

## Technical Stack
- Engine: Clawdbot 2026.1.24-3 [verified: 2026-01-28]
- Model: Claude Opus 4.5 (via Claude Max $100/mo flat) [verified: 2026-01-28]
- OS: Windows 10 (x64), DESKTOP-O6IL62J [verified: 2026-01-26]
- Channels: Telegram (primary), WhatsApp (backup) [verified: 2026-01-26]
- Python: 3.13 at C:\Python313\python.exe [verified: 2026-01-26]
- Node.js: v22.14.0 [verified: 2026-01-26]
- Workspace: C:\dev\FsuelsBot\workspace [verified: 2026-01-26]
- Repo: github.com/fsuels/FsuelsBot (private) [verified: 2026-01-27]

## Capabilities
- 9 ClawdHub skills: marketing, research, humanizer, tweet-writer, reddit, youtube, self-improvement, docs, prompt-engineering [verified: 2026-01-28]
- Brave Search API (web search) [verified: 2026-01-28]
- Gemini CLI (alternative AI, terminal) [verified: 2026-01-28]
- Browser automation (clawd profile) [verified: 2026-01-28]
- Full shell access on Francisco's Windows PC [verified: 2026-01-26]

## Missing Capabilities
- Gemini API key (image generation) [verified: 2026-01-28]
- GitHub CLI not authenticated [verified: 2026-01-28]

## Tools Built
- **Mission Control** — Interactive HTML dashboard (Kanban, Team, Brain, Summary views) on port 8765 [verified: 2026-01-28]
- **Digital Workforce** — team.json with 8 specialist cards, Twin.so-inspired [verified: 2026-01-28]
- **The Council** — Multi-AI debate: Grok + ChatGPT + Gemini → Opus synthesis. 3 modes. $0 extra. [verified: 2026-01-28]
- **Overnight Build System** — 2 AM cron, picks ONE improvement, builds it, commits [verified: 2026-01-28]
- **SEO Scripts** — Product audit, cleanup, optimizer (need Shopify API token) [verified: 2026-01-28]
- **Memory System** — Event ledger, knowledge base, recall pack, consolidation (built 2026-01-28) [verified: 2026-01-28]

## Available AI Resources ($0 extra)
| Service | Model | Access |
|---------|-------|--------|
| Claude Max | Opus 4.5 + Sonnet (unlimited) | Clawdbot native |
| X/Grok | Grok 4.1 Thinking | Browser (research + queries only) |
| ChatGPT Pro | GPT 5.2 | Browser |
| Open Arena | Open-source models | Browser |
| Gemini CLI | Gemini | Terminal (OAuth) |

## Cron Jobs
| Time | Name | Purpose |
|------|------|---------|
| Every 30 min (8AM-10PM) | buckydrop-monitor | Check BuckyDrop support response |
| 2 AM daily | overnight-self-improvement | Build ONE improvement while Francisco sleeps |
| 3 AM daily | memory-consolidation | Extract events, update knowledge, rebuild recall pack |
| 9 AM daily | daily-ai-research-brief | AI news, Clawdbot updates, expert insights |
| 11 PM daily | daily-github-backup | Auto-commit + push workspace to GitHub |
| 6 AM Monday | weekly-self-improvement | Updates, new skills, memory review |
