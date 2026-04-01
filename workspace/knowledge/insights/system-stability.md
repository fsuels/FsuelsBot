---
version: "1.1"
created: "2026-01-28"
updated: "2026-03-31"
verified: "2026-03-31"
confidence: "high"
---

# Insight: System Stability & Crash Prevention

_Learned: 2026-01-28, updated 2026-03-31_
_Source: production incidents across Windows and macOS eras_

## The Insight

Large sessions and unhandled errors are the primary causes of bot crashes. Prevention requires both architectural limits and runtime safeguards. The specifics differ between the Windows/Clawdbot era (pre-February 2026) and the macOS/Moltbot era (current).

## Evidence — Windows Era (Historical)

- Sessions exceeding ~118K tokens trigger API timeouts -> `TypeError: fetch failed` -> process crash [verified: 2026-01-28]
- Without `--unhandled-rejections=warn`, a single failed fetch kills the entire process [verified: 2026-01-28]
- Browser control server congestion (too many open tabs) causes act/snapshot timeouts [verified: 2026-01-27]
- PowerShell inline `$var` assignments get stripped in the heartbeat runtime [verified: 2026-03-16]

## Evidence — macOS Era (Current)

- LM Studio hangs/times out when context is exceeded — no clean error, just silence [verified: 2026-02-09]
- LM Studio auto-reloads models with default 4096 context after idle/restart — must verify with `lms ps` [verified: 2026-02-09]
- Gateway process can be killed by macOS memory pressure on Mac Mini M4 [verified: 2026-02]
- Session overflow: Claude 200K-context sessions cannot be continued in 32K LM Studio models [verified: 2026-02]

## Application — Current Platform (macOS + Moltbot)

### Gateway Stability

1. **Gateway runs as launchd service** (`~/Library/LaunchAgents/bot.molt.gateway.plist`) for auto-restart
2. **Recovery sequence** if gateway is down:
   - `launchctl list bot.molt.gateway` -> check status
   - `pkill -9 -f moltbot-gateway || true` -> kill
   - `nohup moltbot gateway run --bind loopback --port 18789 --force > /tmp/moltbot-gateway.log 2>&1 &`
   - `moltbot channels status --probe` -> verify
3. **Logs** at `~/.clawdbot/logs/gateway.log` and `/tmp/moltbot/moltbot-YYYY-MM-DD.log`

### LM Studio Stability

1. **Always check context** with `lms ps` before sending requests — look at CONTEXT column
2. **Reload if wrong:** `lms load "qwen/qwen3-30b-a3b" --context-length 32768`
3. **Only one large model at a time** — RAM constraint on Mac Mini M4
4. **Use `/no_think` injection** for Qwen3 when thinkLevel=off (5x latency reduction)
5. **Keep `maxTokens: 2048`** and `bootstrapMaxChars: 2000` for local provider

### Session Management

1. **Keep sessions compact** — avoid loading excessive context
2. **Use `/new`** when switching from Claude (200K) to LM Studio (32K) sessions
3. **Close unnecessary browser tabs** — keep under ~15 active tabs
4. **Use sub-agents** for heavy work — isolates context and prevents main session bloat

## Prevention Checklist (Run After Any Crash)

- [ ] Check `lms ps` — is the model loaded with correct context?
- [ ] Check `launchctl list bot.molt.gateway` — is the service running?
- [ ] Check session size — does it need `/new`?
- [ ] Check `/tmp/moltbot/moltbot-YYYY-MM-DD.log` for error details
- [ ] Check macOS Activity Monitor for memory pressure

## Cross-References

- `ops-learnings.md` — individual incident learnings
- `procedures/context-recovery.md` — full context recovery procedure
- MEMORY.md — gateway recovery workflow, LM Studio integration details
