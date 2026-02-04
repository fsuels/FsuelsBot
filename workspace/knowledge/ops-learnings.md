# Ops Learnings

## 2026-02-03
1) **WhatsApp bot identity requires separate number**
   - Context: Wanted Telegram-like bot contact on WhatsApp.
   - Failure: Google Voice number rejected: “not a valid mobile number for United States”.
   - Fix: Use a dedicated mobile-capable number; if $0 constraint, use WhatsApp Desktop automation for outbound-only.
   - Prevention: Don’t promise WhatsApp bot identity until registration succeeds.

2) **whatsapp_login “linked” ≠ verified messaging**
   - Context: OpenClaw reported WhatsApp “already linked” to +17862875660.
   - Failure: Users can mistake linkage for a separate bot identity.
   - Fix: Always run an end-to-end test (send inbound WhatsApp → confirm received; send outbound → confirm delivered).
   - Prevention: Add a checklist step to T225/T226-style tasks: “verify send/receive”.

3) **PowerShell quoting pitfalls in automation**
   - Context: Appending markdown tables & listing file paths.
   - Failure: `|` parsed as pipeline; `ForEach-Object { $_.FullName }` broke under quoting.
   - Fix: Use Python for markdown appends, or PS here-strings; use `Select-Object -ExpandProperty FullName`.
   - Prevention: Prefer Python for multi-line text writes.

4) **Terminator MCP stability: heavy get_window_tree can crash**
   - Context: `get_window_tree` call ended with SIGKILL.
   - Fix: Reduce tree calls, reuse sessions, and keep macros minimal.
   - Prevention: Add “warm agent + session reuse” optimization as a standing ops task.
