---
name: clawd-docs-v2
description: "Access Moltbot documentation. Use when: questions about bot config, channels, tools, gateway setup, or OpenClaw features."
homepage: https://docs.molt.bot/
---

# Moltbot Documentation Access

Look up Moltbot/Clawdbot documentation efficiently using a tiered cache strategy (local snippets first, remote fetch last).

## Trigger Conditions

When to invoke this skill:

- Francisco asks about bot configuration, gateway setup, or channel configuration
- Troubleshooting a bot error that may be covered in docs
- Need to reference Moltbot CLI commands, API, or features
- Francisco says "docs", "how do I configure", "what's the command for"
- An error message contains "clawdbot", "moltbot", or "gateway"

## Required Inputs

| Input | Source       | Required | Example                             |
| ----- | ------------ | -------- | ----------------------------------- |
| query | User message | Yes      | "how to set up Telegram channel"    |
| topic | Inferred     | No       | "telegram-setup", "oauth", "config" |

## Data Collection Steps (Lookup Order -- cheapest first)

1. **Check Golden Snippets** -- tool: `read`
   - Path: `~/clawd/data/docs-snippets/`
   - Match query against snippet filenames (see Available Snippets table)
   - Expected: exact or near-exact match returns cached answer
   - If no match: proceed to step 2

2. **Check Search Index** -- tool: `read`
   - Path: `~/clawd/data/docs-index.json`
   - Search for query keywords in index to find the right page path
   - Expected: page path identified (e.g., `/guides/telegram-setup`)
   - If index missing or no match: proceed to step 3

3. **Fetch specific page** -- tool: `web_fetch`
   - URL: `https://docs.clawd.bot/{path}` with `extractMode: "markdown"`
   - Expected: full page content in markdown
   - If page returns 404: proceed to step 4

4. **Fetch full index (last resort)** -- tool: `web_fetch`
   - URL: `https://docs.clawd.bot/llms.txt` with `extractMode: "markdown"`
   - Search within full index for relevant section
   - Expected: relevant section found
   - If site unreachable: report "docs unavailable" and suggest checking locally

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
|-- docs-index.json       # Search index
|-- docs-snippets/        # Cached answers
+-- docs-cache/           # Full page cache
```

## Output Format

### Deliverable: Documentation Answer

Delivery method: Direct reply in conversation
File path: N/A (inline response)

```
**[Topic]**

[Answer extracted from documentation]

Source: [snippet file / docs URL / index path]
Last updated: [date if known]
```

If the answer requires saving for future reference:

File path: `~/clawd/data/docs-snippets/[new-topic].md`

## Success Criteria

- [ ] Answer found using the cheapest available tier (snippets > index > fetch > full index)
- [ ] Answer is accurate and directly addresses the user's question
- [ ] Source attribution included (which tier and which file/URL)
- [ ] If a new snippet was worth caching, it was saved to `docs-snippets/`

## Error Handling

| Failure                 | Detection                         | Response                                                               |
| ----------------------- | --------------------------------- | ---------------------------------------------------------------------- |
| Snippet not found       | No filename match in snippets dir | Proceed to search index (step 2)                                       |
| Index file missing      | File not found at expected path   | Proceed to web fetch (step 3)                                          |
| Docs site unreachable   | `web_fetch` returns error/timeout | Report "docs unavailable"; suggest checking `~/clawd/data/docs-cache/` |
| Page returns 404        | HTTP 404 response                 | Try full index (step 4); page may have moved                           |
| Answer ambiguous        | Multiple matching sections        | Present top 2-3 candidates; ask Francisco to clarify                   |
| Outdated cached snippet | Snippet date > 30 days old        | Fetch fresh from docs site; update snippet if changed                  |

## Evidence Standards

- Always cite the source tier used (snippet, index, fetched page, full index)
- Include the docs URL when fetching from remote
- Note if a cached snippet may be outdated (check file modification date)
- Distinguish between official documentation and inferred/interpreted answers
- If documentation is ambiguous or incomplete, flag explicitly

## Permission Tiers

| Action                        | Tier | Rule                   |
| ----------------------------- | ---- | ---------------------- |
| Read snippets, index, cache   | 0    | Just do it             |
| Fetch from docs site          | 0    | Just do it             |
| Save new snippet to cache     | 1    | Do it, report after    |
| Modify existing documentation | 2    | Confirm with Francisco |
