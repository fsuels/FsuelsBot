---
name: clawd-docs-v2
description: "Access Moltbot documentation. Use when: questions about bot config, channels, tools, gateway setup, or OpenClaw features."
homepage: https://docs.molt.bot/
---

# Moltbot Documentation Access

## Lookup Order (cheapest first)

1. **Golden Snippets** — check `~/clawd/data/docs-snippets/` first
2. **Search Index** — check `~/clawd/data/docs-index.json` for page path
3. **Fetch page** — `web_fetch({ url: "https://docs.clawd.bot/{path}", extractMode: "markdown" })`
4. **Full index** — `web_fetch({ url: "https://docs.clawd.bot/llms.txt", extractMode: "markdown" })`

## Available Snippets

| Snippet file            | Matches                           |
| ----------------------- | --------------------------------- |
| `telegram-setup.md`     | telegram setup                    |
| `telegram-allowfrom.md` | allowFrom, access control         |
| `oauth-troubleshoot.md` | token expired, oauth error        |
| `update-procedure.md`   | update clawdbot                   |
| `restart-gateway.md`    | restart, stop/start               |
| `config-basics.md`      | config, settings                  |
| `config-providers.md`   | add provider, discord setup       |
| `memory-search.md`      | memory, vector search, embeddings |

## Data Locations

```
~/clawd/data/
├── docs-index.json       # Search index
├── docs-snippets/        # Cached answers
└── docs-cache/           # Full page cache
```
