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

## 3. Verify State
- Read memory/state.json to restore context
- Read memory/active-thread.md for current work
- Check AGENTS.md CURRENT STATE section

After completing these tasks, reply with NO_REPLY (don't send a separate startup message beyond the URL).
