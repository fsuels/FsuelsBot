# Error Log

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
