# Nightly Learn — 2026-03-16

## 1) Watchdog script dependency (missing file breaks recovery)

- **Context:** WATCHDOG_NONSTOP_GUARD expects `workspace/scripts/nonstop-guard.ps1`.
- **Failure:** Script was missing → watchdog could not run stall detection or recovery.
- **Fix:** Added `workspace/scripts/nonstop-guard.ps1` and validated output; committed/pushed.
- **Prevention:** Keep watchdog-referenced scripts under version control; consider a startup check that verifies required script paths exist.
- **Evidence:** commit `74892bc56`.

## 2) ClawdHub CLI `update` fails on Windows (relative URL parse)

- **Context:** Weekly Self-Improvement required `clawdhub update --all`.
- **Failure:** `clawdhub update` errors: `Failed to parse URL from /api/v1/skills/<slug>` even when registry base is provided.
- **Fix:** Documented the bug + current workarounds (explore/search/install by slug).
- **Prevention:** Use `curl.exe -sL https://clawdhub.com/.well-known/clawdhub.json` to discover registry (`https://clawhub.ai`), and avoid `update --all` on Windows until fixed.
- **Evidence:** `workspace/knowledge/technical/clawdhub-update-windows-relative-url-bug.md`, commit `74892bc56`.

## 3) Heartbeat runtime strips `$var` in inline PowerShell one-liners

- **Context:** Several automation one-liners failed with errors like `= : The term '=' is not recognized` and `.Name is not recognized`.
- **Failure:** Inline commands containing `$x=...` appear to lose `$x` before execution (becomes `=1`), causing parse/runtime errors.
- **Fix:** Recorded rule: avoid `$` in one-liners; prefer file-based scripts, `Set-Variable`, or Python.
- **Prevention:** Update procedures to avoid PowerShell one-liners that rely on variables.
- **Evidence:** `workspace/memory/2026-03-16.md`.

## 4) Ghost Broker repos appear as gitlinks without `.gitmodules`

- **Context:** `workspace/ghost-broker/admin` and `workspace/ghost-broker/website` show as modified in parent repo.
- **Failure:** They’re tracked as gitlink entries (mode 160000), but there is no `.gitmodules`, so `git submodule` tooling fails and parent repo always appears dirty.
- **Fix:** Diagnosed origins (admin: https://github.com/GhostBrokerAI/admin.git, website: https://github.com/GhostBrokerAI/ghostbrokerai.github.io.git).
- **Prevention:** Decide: add `.gitmodules` and manage as real submodules OR remove gitlink tracking from parent repo.
- **Evidence:** `git ls-tree HEAD workspace/ghost-broker/admin` shows mode 160000; Telegram note sent.

## 5) Keep runnable lanes clean by moving blocked cron tasks to `human`

- **Context:** Multiple cron tasks required logged-in browser access not available in heartbeat runtime.
- **Failure:** These tasks would stall bot_current/queue and trigger watchdog noise.
- **Fix:** Move blocked tasks to `human` lane with explicit blocker text; continue to next runnable.
- **Prevention:** Cron-to-task could optionally classify “needs browser” tasks as WAITING_HUMAN automatically when capabilities=none.
- **Evidence:** tasks moved (e.g., `CRON-20260316-buckydrop-check`, X engagement tasks, `CRON-20260316-epistemic-review-evening`).
