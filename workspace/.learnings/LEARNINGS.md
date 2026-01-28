# Learnings Log

## [LRN-20260127-007] critical_fix

**Logged**: 2026-01-27T06:20:00Z
**Priority**: critical
**Status**: promoted
**Area**: infra

### Summary
Gateway disconnections caused by: (1) Memory pressure — 16GB system with only 2.5GB free, running 10+ parallel exec commands crashed the gateway. (2) config.patch triggers restart — each patch = disconnect. (3) ClawdHub search timeouts — holding memory while waiting.

### Rules Going Forward
- **MAX 2-3 parallel exec commands** at any time
- **Batch config changes** into single patch instead of multiple
- **Never run more than 3 ClawdHub searches** at once
- **Monitor memory** before heavy operations: `Get-CimInstance Win32_OperatingSystem | Select FreePhysicalMemory`
- **Kill hung processes** promptly — don't let timeouts pile up

---

## [LRN-20260127-001] best_practice

**Logged**: 2026-01-27T04:44:00Z
**Priority**: high
**Status**: promoted
**Area**: config

### Summary
On Windows, `chmod` doesn't work. Use `icacls` for file permissions.

---

## [LRN-20260127-002] best_practice

**Logged**: 2026-01-27T04:44:00Z
**Priority**: medium
**Status**: promoted
**Area**: config

### Summary
PowerShell uses `;` as command separator, not `&&`. Use `curl.exe` not `curl`.

---

## [LRN-20260127-004] best_practice

**Logged**: 2026-01-27T04:44:00Z
**Priority**: critical
**Status**: promoted
**Area**: config

### Summary
Less is more. Fewer tools = better performance. Context is precious. (via @steipete)

---

## [LRN-20260127-005] best_practice

**Logged**: 2026-01-27T05:07:00Z
**Priority**: critical
**Status**: resolved
**Area**: infra

### Summary
DuckDuckGo HTML + Gemini CLI as web search workarounds. Now also have Brave Search API configured.

---

## [LRN-20260127-006] best_practice

**Logged**: 2026-01-27T05:07:00Z
**Priority**: high
**Status**: promoted
**Area**: philosophy

### Summary
Francisco's core directive: Don't wait. Be resourceful. Solve problems independently.

---
