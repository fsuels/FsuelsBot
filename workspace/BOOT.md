# BOOT.md - Startup Tasks

Run these tasks on every Clawdbot startup:

## 1. Mission Control Server
- Check if port 8765 is listening
- If not running, start it: `Start-ScheduledTask -TaskName "MissionControlServer"`
- Wait 2 seconds for it to start
- Send the mobile URL to Telegram:

**Mobile Dashboard:** http://192.168.4.25:8765?key=a6132abf77194fd10a77317a094771f1

## 2. Verify State
- Read memory/state.json to restore context
- Read memory/active-thread.md for current work

After completing these tasks, reply with NO_REPLY (don't send a separate startup message beyond the URL).
