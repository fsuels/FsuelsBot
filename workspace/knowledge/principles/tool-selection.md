---
version: "1.1"
created: "2026-01-28"
updated: "2026-03-31"
verified: "2026-03-31"
confidence: "high"
---

# Principle: Tool & Service Selection

_Priority: P1_
_Established: 2026-01-26_
_Source: USER.md — Francisco's values_

## Rule

When choosing tools, services, or platforms, prefer:

1. Open source over proprietary
2. Free/community tier over paid when quality is comparable
3. Self-hosted over SaaS when practical
4. Open protocols over walled gardens
5. Transparent pricing over hidden costs

## Rationale

Francisco values open source and believes in community-driven development. He's also budget-constrained ($0 extra for new tools). Open tools give control, transparency, and zero lock-in risk.

## Exceptions

- If an open source tool is significantly worse, the proprietary option can be considered
- Francisco must approve any paid tool regardless
- Existing paid subscriptions (Claude, X, ChatGPT) are grandfathered in

## Current Tool Stack (as of 2026-03-31)

| Category             | Tool                                      | Type     | Notes                                  |
| -------------------- | ----------------------------------------- | -------- | -------------------------------------- |
| AI inference (cloud) | Claude (Anthropic)                        | Paid     | Primary, via Claude Code               |
| AI inference (local) | LM Studio + Qwen3-30B                     | Free/OSS | Secondary, for low-latency local tasks |
| Bot gateway          | Moltbot                                   | Custom   | Self-hosted on Mac Mini M4             |
| Browser automation   | Claude in Chrome, Control Chrome          | MCP      | Free extensions                        |
| macOS control        | Peekaboo, automation-mcp, macos-automator | MCP/OSS  | Free, self-hosted                      |
| Messaging            | Telegram Bot API                          | Free     | Primary notification channel           |
| E-commerce           | Shopify                                   | Paid     | DLM storefront                         |
| Fulfillment          | BuckyDrop                                 | Paid     | Dropship partner                       |
| Version control      | Git/GitHub                                | Free     | All projects                           |
| PDF tools            | PDF MCP server                            | Free     | Form filling and extraction            |

## Decision Framework for New Tools

When evaluating a new tool, answer these questions in order:

1. **Does an existing tool already do this?** Check `capabilities.md` (135+ tools documented). If yes, use it.
2. **Is there an MCP server for it?** Check `mcp-registry` search. MCP servers integrate cleanly with the bot.
3. **Does it work on macOS ARM (M4)?** Mac Mini M4 is the only runtime. No cloud VMs, no Windows.
4. **Does it require a paid subscription?** If yes, needs Francisco's explicit approval.
5. **Does it require granting new permissions?** Screen Recording and Accessibility are already granted for `com.anthropic.claude-code`. New permissions may need TCC database edits.

## Anti-Patterns

- Installing a new MCP server when an existing tool (osascript, curl, built-in CLI) can do the job
- Choosing a tool because it's trendy rather than because it solves a real problem
- Using a paid API when a local model or free alternative exists
- Adding tools without documenting them in capabilities.md

## Cross-References

- `principles/deletion-doctrine.md` — "should this tool exist in our stack?"
- `principles/budget-rules.md` — spending constraints
- MEMORY.md (in `.claude/`) — full tool/MCP inventory with proven capabilities
