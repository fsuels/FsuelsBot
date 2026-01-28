# 🔒 Clawdbot Security Audit Report
**Date:** January 28, 2026  
**Auditor:** Deep Dive (Research Analyst subagent)  
**Scope:** Full security audit of Clawdbot gateway, file permissions, network exposure, and configuration

---

## Executive Summary

**Overall Posture: GOOD with 2 actionable items**

The Clawdbot gateway is properly locked down to loopback. NTFS file permissions are correctly restricted to the owner (Fsuels), SYSTEM, and Administrators only — no world-readable files found. Windows Firewall is enabled on all profiles.

Two real issues found:
1. **Port 8765 (activity-server.py) is exposed on all network interfaces** (0.0.0.0) — should be loopback-only
2. **Three duplicate Python processes** running activity-server.py on port 8765

The Clawdbot built-in audit reports 4 CRITICAL findings, but these are **false positives** caused by Unix-style mode checks (mode=666) that don't accurately reflect Windows NTFS ACLs. Actual `icacls` inspection confirms proper restrictions.

---

## Checks Performed

### 1. Clawdbot Security Audit (`clawdbot security audit --deep`)

**Result:** 4 critical, 2 warn, 1 info reported by tool

| Finding | Clawdbot Says | Actual NTFS ACL | Verdict |
|---------|--------------|-----------------|---------|
| State dir world-writable | mode=666 | Fsuels/SYSTEM/Admins only | ⚠️ False positive |
| Config file writable by others | mode=666 | Fsuels/SYSTEM/Admins only | ⚠️ False positive |
| Credentials dir writable | mode=666 | **Fsuels only** | ⚠️ False positive |
| auth-profiles.json writable | mode=666 | **Fsuels only** | ⚠️ False positive |
| Trusted proxies missing | Not configured | Gateway is loopback-only | ℹ️ N/A (local only) |
| sessions.json readable | mode=666 | **Fsuels only** | ⚠️ False positive |

**Analysis:** Clawdbot's audit uses Unix `stat()` which returns mode=666 on Windows for all files. This is a known cross-platform limitation. The actual Windows NTFS ACLs are properly restrictive. No "Everyone", "BUILTIN\Users", or "Authenticated Users" group has access to any Clawdbot file.

### 2. Network Port Exposure (Port 18789 — Gateway)

**Result: ✅ PASS**

```
TCP    127.0.0.1:18789    0.0.0.0:0    LISTENING
TCP    [::1]:18789        [::]:0       LISTENING
```

- Gateway binds exclusively to `127.0.0.1` and `[::1]` (IPv6 loopback)
- All established connections are loopback-to-loopback (`127.0.0.1 ↔ 127.0.0.1`)
- **No external network interface exposure**
- Gateway config confirms: `bind=loopback (127.0.0.1), port=18789`

### 3. Port 8765 — Activity Server (Python)

**Result: ❌ FAIL — EXPOSED ON ALL INTERFACES**

```
TCP    0.0.0.0:8765    0.0.0.0:0    LISTENING    [python.exe]
```

- **Three** Python processes listening on `0.0.0.0:8765` (PIDs: 46736, 56060, 57392)
- Source: `C:\dev\FsuelsBot\workspace\mission-control\activity-server.py`
- Binding to `0.0.0.0` means any device on the network can connect
- This is the mission-control activity dashboard WebSocket server

### 4. File Permissions — Clawdbot Config Directory

**Result: ✅ PASS**

| Path | ACL | Status |
|------|-----|--------|
| `.clawdbot\` (dir) | Fsuels(F), SYSTEM(F), Admins(F) | ✅ |
| `clawdbot.json` | Fsuels(F), SYSTEM(F), Admins(F) | ✅ |
| `credentials\` (dir) | **Fsuels(F) only** | ✅ Best |
| `credentials\telegram-pairing.json` | **Fsuels(F) only** | ✅ Best |
| `credentials\telegram-allowFrom.json` | **Fsuels(F) only** | ✅ Best |
| `identity\device-auth.json` | Fsuels(F), SYSTEM(F), Admins(F) | ✅ |
| `identity\device.json` | Fsuels(F), SYSTEM(F), Admins(F) | ✅ |
| `agents\` (dir) | **Fsuels(F) only** | ✅ Best |

No file in the `.clawdbot` directory has "Everyone", "BUILTIN\Users", or "Authenticated Users" access.

### 5. Broad Access Scan (All .clawdbot JSON files)

**Result: ✅ PASS — No world-readable files found**

Scanned all 18 JSON files under `.clawdbot\`. None have broad access groups in their ACLs.

### 6. Windows Firewall Status

**Result: ✅ PASS**

| Profile | State |
|---------|-------|
| Domain | ON |
| Private | ON |
| Public | ON |

### 7. Workspace Files

**Result: ✅ PASS**

- Workspace `.md` files: Fsuels(F), SYSTEM(F), Admins(F) — properly restricted
- No `.env` file at repo root (good — no leaked secrets)

### 8. External Listening Ports (Non-Loopback)

**Result: ⚠️ INFORMATIONAL**

Standard Windows services on 0.0.0.0:
- Port 135 (RPC), 445 (SMB), 139 (NetBIOS) — standard Windows, firewall protected
- Port 5040, 5357, 7680 — Windows services (SSDP, WSD, Delivery Optimization)
- Ports 49664-49669 — Windows dynamic RPC endpoints
- **Port 8765 — activity-server.py** ← the only non-standard one

---

## Summary

| Check | Result | Priority |
|-------|--------|----------|
| Gateway loopback-only | ✅ PASS | — |
| Config file permissions | ✅ PASS | — |
| Credentials locked to owner | ✅ PASS | — |
| Identity files secured | ✅ PASS | — |
| No world-readable files | ✅ PASS | — |
| Windows Firewall enabled | ✅ PASS | — |
| No .env secrets exposed | ✅ PASS | — |
| Clawdbot audit mode=666 | ⚠️ False positive (Windows) | Low |
| Port 8765 on 0.0.0.0 | ❌ FAIL | **P1 — High** |
| Duplicate Python processes | ❌ FAIL | **P2 — Medium** |

---

## Recommended Fixes

### P1 — HIGH: Bind activity-server.py to localhost only
**File:** `mission-control/activity-server.py`  
**Issue:** WebSocket server binds to `0.0.0.0:8765`, accessible from any network interface  
**Fix:** Change the bind address from `0.0.0.0` to `127.0.0.1` (or `localhost`)  
**Risk:** Any device on the local network (or VPN) could connect and read/modify mission-control data  
**Effort:** 1 line change

### P2 — MEDIUM: Kill duplicate activity-server processes
**Issue:** Three Python processes (PIDs 46736, 56060, 57392) all listening on port 8765  
**Fix:** Kill the stale processes: `taskkill /PID 56060 /F` and `taskkill /PID 57392 /F`, keep one  
**Risk:** Resource waste; potential port conflicts or stale data  
**Effort:** Immediate

### P3 — LOW: Acknowledge Clawdbot audit false positives
**Issue:** `clawdbot security audit` reports mode=666 on Windows — this is a cross-platform detection bug  
**Fix:** No action needed; actual NTFS ACLs are correct. Consider filing an issue upstream if desired.  
**Risk:** None (cosmetic)

---

## Conclusion

The core Clawdbot installation is **well-secured**. The gateway is properly loopback-bound, all sensitive files have appropriate NTFS permissions, and Windows Firewall is active on all profiles. The only real finding is the activity-server.py binding to all interfaces — a quick one-line fix.

---
*Audit completed by Deep Dive 🔬 at 2026-01-28T12:15:00-05:00*
