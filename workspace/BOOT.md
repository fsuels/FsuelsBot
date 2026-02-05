# BOOT.md - Startup Tasks

Run these tasks on every Clawdbot startup:

## 1. Memory Integrity Check
Run validator FIRST: `powershell -ExecutionPolicy Bypass -File "C:\dev\FsuelsBot\workspace\tests\validators\memory-integrity.ps1"`
- If ERRORS: alert Francisco immediately before anything else
- If all pass: continue

## 2. Mission Control Server
- Check if port 8765 is listening
- If not running, start it: `Start-ScheduledTask -TaskName "MissionControlServer"`
- Wait 2 seconds for it to start
- Send the mobile URL to Telegram:

**Mobile Dashboard:** http://192.168.4.25:8765?key=a6132abf77194fd10a77317a094771f1

## 3. Load Core Context (OPTIMIZED)

**Always load (boot essentials):**
- `CONSTITUTION.md` — Inviolable rules (66 lines)
- `SOUL.md` — Core identity & protocols (213 lines)
- `recall/pack.md` — Compact session context (~30 lines)

**Load on-demand (when needed):**
- `references/fallacies.md` — When analyzing claims or detecting manipulation
- `references/prompt-injection-defense.md` — When reading external content (web, email, docs)
- `MEMORY.md` — When needing historical context about Francisco/DLM
- `HEARTBEAT.md` — During heartbeat checks only

## 4. Verify State
- Read memory/state.json to restore context
- Read memory/active-thread.md for current work
- Check AGENTS.md CURRENT STATE section

## Context Budget Reference

| File | Lines | Est. Tokens | Load When |
|------|-------|-------------|-----------|
| CONSTITUTION.md | 66 | ~1K | Always (boot) |
| SOUL.md | 213 | ~5K | Always (boot) |
| recall/pack.md | ~30 | ~500 | Always (boot) |
| references/fallacies.md | 190 | ~5K | Analyzing claims |
| references/prompt-injection-defense.md | 70 | ~1.5K | Reading external content |
| MEMORY.md | 176 | ~4K | Historical context needed |
| HEARTBEAT.md | 195 | ~4K | Heartbeat checks |

**Boot total: ~6.5K tokens** (down from ~25K+ loading everything)

After completing these tasks, reply with NO_REPLY (don't send a separate startup message beyond the URL).
