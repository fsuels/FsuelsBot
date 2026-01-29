# Moltbot Docs Audit Results
**Date:** 2026-01-29
**Time spent:** ~30 min (within 2hr cap)
**Auditor:** Fsuels Bot

---

## Quick Summary

| Category | Verdict | Action |
|----------|---------|--------|
| AGENTS.md template | ✅ Aligned + extended | No changes needed |
| SOUL.md | ✅ Strong | No changes needed |
| Security | ⚠️ File perms issue | Fix with icacls |
| Skills | ✅ Good | Check for updates |
| Cron | ✅ Good | Model override available |
| Sessions | ✅ Good | No changes needed |

---

## 1. Security Audit (CRITICAL)

Ran `clawdbot security audit`:

```
4 critical · 2 warn · 1 info
```

### Critical Issues (File Permissions)
- State dir is world-writable: `C:\Users\Fsuels\.clawdbot`
- Config file writable by others: `clawdbot.json`
- Credentials dir writable: `credentials/`
- Auth profiles writable: `auth-profiles.json`

**Windows fix needed:** Use `icacls` instead of chmod:
```powershell
icacls "C:\Users\Fsuels\.clawdbot" /inheritance:r /grant "Fsuels:(OI)(CI)F" /grant "SYSTEM:(OI)(CI)F"
```

### Action: ✅ ADOPT NOW
Fix file permissions for security.

---

## 2. AGENTS.md Comparison

**Official template:** ~3KB, simple structure
**Our version:** ~21KB, extensive customizations

### We have (custom, keep them):
- 4-layer memory system (raw → ledger → knowledge → recall) ✅
- Task board with step-tracking ✅
- Mission Control dashboard ✅
- Council protocol ✅
- Procedure checkpoints ✅
- Context truncation recovery ✅
- Execution-first operator mindset ✅

### They have (we're aligned):
- Session startup sequence ✅ (we have this + more)
- Memory maintenance ✅
- Group chat behavior ✅
- Heartbeat guidance ✅

**Action:** ❌ IGNORE - Our AGENTS.md is more sophisticated, no changes needed.

---

## 3. Skills System

Official docs mention:
- ClawdHub integration ✅ (we have this)
- Skills watcher auto-refresh ✅ (enabled by default)
- Token impact calculation (195 chars base + 97 per skill)

**Action:** 
- ❌ IGNORE - already aligned
- Optional: Run `clawdhub update --all` periodically

---

## 4. Cron Jobs

New features discovered:
- **Model override per job:** `--model opus --thinking high`
- **Post-to-main modes:** summary vs full
- **Auto-delete one-shots:** `--delete-after-run`

Our current cron jobs:
- CRON-research (9 AM daily)
- CRON-curiosity (9 PM daily)
- CRON-learn (10:30 PM daily)
- CRON-ship (11 PM daily)
- CRON-backup (11:45 PM daily)
- CRON-consolidation (3 AM daily)

**Action:** 🔄 REVISIT - Consider model override for expensive jobs (e.g., deep analysis)

---

## 5. Session Management

We're using:
- Main session for DMs ✅
- Isolated sessions for groups ✅
- 4 AM daily reset ✅

Official recommends:
- `per-channel-peer` for multi-user inboxes
- `identityLinks` to merge identities across channels

**Action:** ❌ IGNORE - We're single-user, current config is correct.

---

## 6. Security Best Practices (from docs)

Checklist from official docs:
- [x] DM pairing mode (not open) - ✅ We use allowlist
- [x] Tool blast radius limited - ✅ We have elevated approvals
- [x] Network exposure minimal - ✅ Loopback only
- [x] Browser control restricted - ✅ Disabled for remote
- [ ] File permissions locked - ⚠️ NEEDS FIX
- [x] Plugins allowlisted - ✅ N/A (no plugins)
- [x] Modern model used - ✅ Opus 4.5

---

## Final Verdicts

### ✅ ADOPT NOW (Do immediately)
1. **Fix file permissions** - Security critical

### ❌ IGNORE (No action needed)
1. AGENTS.md template - Ours is more advanced
2. SOUL.md - Strong, no gaps
3. Skills config - Already aligned
4. Session config - Correct for our use case

### 🔄 REVISIT (If scale increases)
1. Model overrides for cron jobs - When we need cost optimization
2. Per-channel-peer sessions - If we add more users

---

## Implementation

### Step 1: Fix File Permissions (NOW)

Francisco needs to run these commands as Admin:

```powershell
# Remove inheritance and restrict to user + SYSTEM only
icacls "C:\Users\Fsuels\.clawdbot" /inheritance:r /grant:r "Fsuels:(OI)(CI)F" /grant:r "SYSTEM:(OI)(CI)F" /grant:r "Administrators:(OI)(CI)F"
```

Then re-run: `clawdbot security audit`

---

*Audit complete. Time: 30 min (under 2hr cap)*
