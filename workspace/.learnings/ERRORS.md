# Error Log

## [ERR-20260128-001] clawdbot_unhandled_fetch_rejection_crash

**Logged**: 2026-01-28T00:17:00-05:00
**Severity**: HIGH
**Category**: gateway_crash
**Frequency**: Multiple times on Jan 27 (Francisco reported disconnections throughout the day)

**Error**:
```
Unhandled promise rejection: TypeError: fetch failed
  at node:internal/deps/undici/undici:13502:13
  at processTicksAndRejections (node:internal/process/task_queues:105:5)
```

**Context**:
- Occurred at ~00:13 EST on Jan 28 (05:13 UTC)
- Preceded by rapid chat.history websocket calls (every 6-8 seconds)
- Gateway was under heavy load: browser automation (multiple tabs), sub-agent spawned, large session context (~118K tokens)
- This was the latest in multiple disconnections throughout Jan 27

**Terminal logs before crash**:
```
05:13:00 [ws] ⇄ res ✓ chat.history 671ms conn=a4bdaf44…785d id=898b053a…5f7d
05:13:08 [ws] ⇄ res ✓ chat.history 645ms conn=a4bdaf44…785d id=084bac2e…ced1
05:13:14 [ws] ⇄ res ✓ chat.history 662ms conn=a4bdaf44…785d id=eadf63d5…23b1
05:13:14 [clawdbot] Unhandled promise rejection: TypeError: fetch failed
```

**Root cause hypothesis**:
1. `fetch failed` from undici = a network request failed (DNS, timeout, or connection refused)
2. Could be: Anthropic API call, browser control server, or sub-agent communication
3. The promise rejection was not caught by a try/catch, crashing the process
4. Heavy browser automation + large context may have overwhelmed the gateway

**Workaround**:
- Gateway auto-restarts after crash
- Session reconnects automatically
- Reduce concurrent browser tabs to lower load
- Mac Mini (arriving Jan 29) should improve stability with dedicated hardware

**Fix needed**:
- This is a Clawdbot engine bug — unhandled promise rejections should be caught
- Should report to Clawdbot GitHub issues or Discord
- `process.on('unhandledRejection')` handler may need improvement

**Impact**: Session disconnection. No data loss (memory files + git preserved). Francisco experiences interruption.

---

## [ERR-20260127-001] clawdhub_search_timeout

**Logged**: 2026-01-27T04:44:00Z
**Severity**: medium
**Tool**: clawdhub CLI
**Command**: `clawdhub search "<query>"`

### Error
Most ClawdHub search queries timeout with: "Non-error was thrown: Timeout"

### Context
Tried: "shopify", "email", "marketing ecommerce", "writing content", "web search browser", "image generate"
Only "agent" and "tools" returned results.

### Workaround
Use broad single-word queries. Use web browser for browsing ClawdHub.

---

## [ERR-20260127-002] wttr_in_timeout

**Logged**: 2026-01-27T04:44:00Z
**Severity**: low
**Tool**: wttr.in weather API
**Command**: `curl.exe -s "wttr.in/Naples+FL?format=3"`

### Error
Both curl.exe and web_fetch failed to connect to wttr.in. Likely temporary service outage.

### Workaround
Try again later. Alternative: use browser to check weather sites.

---
