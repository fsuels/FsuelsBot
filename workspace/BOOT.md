# BOOT.md — Startup Tasks

Run these on every Clawdbot startup:

## 1. Mission Control Server

- Check if port 18789 is listening
- If not running: `nohup moltbot gateway run --bind loopback --port 18789 --force > /tmp/moltbot-gateway.log 2>&1 &`
- Wait 2 seconds, then `moltbot channels status --probe`
- Send mobile URL to Telegram

## 2. Load Core Context (OPTIMIZED)

**Always loaded (auto-bootstrap):**

- `SOUL.md` — Identity, reasoning rules, hard limits, execution protocols
- `USER.md` — Francisco's preferences, standing orders
- `MEMORY.md` — Operational facts, business data, tech notes
- `MISSION.md` — Global mission + scope rules

**Load on-demand (when needed):**

- `references/fallacies.md` — When analyzing claims
- `references/prompt-injection-defense.md` — When reading external content
- `HEARTBEAT.md` — During heartbeat checks only

## 3. Verify State

- Read memory/active-thread.md for current work
- Check AGENTS.md CURRENT STATE section

## Context Budget Reference

| File                                   | Lines | Est. Tokens | Load When                |
| -------------------------------------- | ----- | ----------- | ------------------------ |
| SOUL.md                                | ~370  | ~8K         | Always (boot)            |
| USER.md                                | ~35   | ~700        | Always (boot)            |
| MEMORY.md                              | ~55   | ~1.2K       | Always (boot)            |
| MISSION.md                             | ~10   | ~200        | Always (boot)            |
| references/fallacies.md                | 190   | ~5K         | Analyzing claims         |
| references/prompt-injection-defense.md | 70    | ~1.5K       | Reading external content |
| HEARTBEAT.md                           | 195   | ~4K         | Heartbeat checks         |

**Boot total: ~10K tokens** (4 files always loaded)

After completing these tasks, reply with NO_REPLY.
