---
version: "1.1"
created: "2026-02-03"
updated: "2026-03-31"
verified: "2026-03-31"
confidence: "high"
---

# Ops Learnings

Operational lessons extracted from production incidents. Each entry follows the pattern: Context, Failure, Fix, Prevention.

---

## 2026-02-03 (Windows/Clawdbot Era — Historical)

### 1) WhatsApp bot identity requires separate number

- **Context:** Wanted Telegram-like bot contact on WhatsApp.
- **Failure:** Google Voice number rejected: "not a valid mobile number for United States".
- **Fix:** Use a dedicated mobile-capable number; if $0 constraint, use WhatsApp Desktop automation for outbound-only.
- **Prevention:** Don't promise WhatsApp bot identity until registration succeeds.
- **Status:** Deprioritized. Telegram is the primary channel. WhatsApp only if Francisco requests it again.

### 2) whatsapp_login "linked" does not equal verified messaging

- **Context:** OpenClaw reported WhatsApp "already linked" to +17862875660.
- **Failure:** Users can mistake linkage for a separate bot identity.
- **Fix:** Always run an end-to-end test (send inbound -> confirm received; send outbound -> confirm delivered).
- **Prevention:** Add a checklist step: "verify send/receive" for any new messaging channel.
- **Broader lesson:** Never declare a channel "working" until a round-trip message is confirmed.

### 3) PowerShell quoting pitfalls in automation

- **Context:** Appending markdown tables and listing file paths.
- **Failure:** `|` parsed as pipeline; `ForEach-Object { $_.FullName }` broke under quoting.
- **Fix:** Use Python for markdown appends, or PS here-strings; use `Select-Object -ExpandProperty FullName`.
- **Prevention:** Prefer Python for multi-line text writes.
- **Status:** No longer applicable. System moved to macOS. Python/bash are the standard scripting tools.

### 4) Terminator MCP stability: heavy get_window_tree can crash

- **Context:** `get_window_tree` call ended with SIGKILL.
- **Fix:** Reduce tree calls, reuse sessions, and keep macros minimal.
- **Prevention:** Add "warm agent + session reuse" optimization as a standing ops task.
- **Status:** No longer applicable. Terminator MCP not in use on macOS. Replaced by Peekaboo and automation-mcp.

---

## 2026-03-16 (macOS/Moltbot Era — Current)

_Extracted from `knowledge/ops/nightly-learn-2026-03-16.md`_

### 5) LM Studio context auto-reset after idle

- **Context:** LM Studio reloads models with default 4096 context after restart or idle period.
- **Failure:** System prompt alone is ~11K tokens with minimal mode -> instant failure at 4K context.
- **Fix:** Always verify with `lms ps` — check CONTEXT column. Reload with `lms load "qwen/qwen3-30b-a3b" --context-length 32768`.
- **Prevention:** Activity server model switching now does unload-before-load. Gateway `/model` directive path does NOT auto-switch.

### 6) Session overflow across model boundaries

- **Context:** Large sessions built under Claude (200K context) cannot be continued in LM Studio (32K).
- **Failure:** LM Studio hangs/times out silently.
- **Fix:** Use `/new` when switching from Claude to LM Studio.
- **Prevention:** Document this as a standing rule in MEMORY.md.

### 7) Gateway recovery must be proactive

- **Context:** Gateway process can die under macOS memory pressure.
- **Failure:** Bot goes silent on Telegram until manually restarted.
- **Fix:** `launchctl list bot.molt.gateway` -> check, `pkill -9 -f moltbot-gateway` -> restart with `nohup`.
- **Prevention:** Treat this as automatic recovery — don't ask, just do it. See MEMORY.md recovery workflow.

---

## Meta-Pattern

Across all incidents, the recurring lesson is: **never trust a "working" status without end-to-end verification.** This applies to:

- Messaging channels (send AND receive must work)
- Model loading (check context size, not just "loaded")
- Gateway status (probe, don't just check the PID)
- Browser connections (navigate to a page, don't just check the extension is installed)
