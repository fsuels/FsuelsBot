# Non-Stop Watchdog Setup

This watchdog monitors your Moltbot agent and alerts you via Telegram if the bot goes idle while tasks are pending in `bot_current`.

## What It Does

- Runs every **5 minutes** in the background
- Checks if `bot_current` has tasks
- If idle for **>10 minutes** with pending tasks → sends Telegram alert
- Helps you catch when the agent stops working unexpectedly

---

## macOS Setup

### 1. Make the script executable
```bash
cd /path/to/workspace/scripts
chmod +x nonstop-watchdog.sh
chmod +x setup-watchdog-launchd.sh
```

### 2. Run the setup script
```bash
./setup-watchdog-launchd.sh
```

This creates a **launchd agent** that runs every 5 minutes.

### 3. Test manually
```bash
./nonstop-watchdog.sh
```

### Useful Commands (macOS)
```bash
# Check if watchdog is running
launchctl list | grep moltbot

# View logs
tail -f ../logs/watchdog.log

# Stop the watchdog
launchctl unload ~/Library/LaunchAgents/com.moltbot.nonstop-watchdog.plist

# Restart the watchdog
launchctl unload ~/Library/LaunchAgents/com.moltbot.nonstop-watchdog.plist
launchctl load ~/Library/LaunchAgents/com.moltbot.nonstop-watchdog.plist
```

---

## Windows Setup

### 1. Open PowerShell as Administrator

### 2. Run the setup script
```powershell
cd C:\path\to\workspace\scripts
.\setup-watchdog-cron.ps1
```

This creates a **Windows Task Scheduler** task that runs every 5 minutes.

### 3. Test manually
```powershell
.\nonstop-watchdog.ps1
```

### Useful Commands (Windows)
```powershell
# View the scheduled task
Get-ScheduledTask -TaskName "MoltbotNonstopWatchdog"

# Run it manually
Start-ScheduledTask -TaskName "MoltbotNonstopWatchdog"

# Stop/remove it
Unregister-ScheduledTask -TaskName "MoltbotNonstopWatchdog" -Confirm:$false
```

---

## Configuration

Both scripts use these defaults:
- **Max idle time**: 10 minutes (change with `--max-idle-minutes 15`)
- **Telegram alerts**: Enabled (disable with `--no-telegram`)
- **Quiet mode**: Use `--quiet` for no console output

### Example with custom settings:
```bash
# macOS - alert after 15 minutes, no console output
./nonstop-watchdog.sh --max-idle-minutes 15 --quiet

# Windows
.\nonstop-watchdog.ps1 -MaxIdleMinutes 15 -Quiet
```

---

## Recommended Moltbot Config

Copy these settings to `~/.clawdbot/moltbot.json` for maximum proactivity:

```json
{
  "agents": {
    "defaults": {
      "heartbeat": {
        "every": "5m",
        "prompt": "Read HEARTBEAT.md. If bot_current has tasks, EXECUTE IMMEDIATELY. If empty, reply HEARTBEAT_OK.",
        "ackMaxChars": 500
      },
      "queue": {
        "mode": "auto",
        "drainDelayMs": 2000
      }
    }
  },
  "session": {
    "maxIdleMinutes": 5,
    "autoResumeOnIdle": true
  }
}
```

---

## Files

| File | Platform | Purpose |
|------|----------|---------|
| `nonstop-watchdog.sh` | macOS/Linux | Main watchdog script |
| `setup-watchdog-launchd.sh` | macOS | Installs launchd agent |
| `nonstop-watchdog.ps1` | Windows | Main watchdog script |
| `setup-watchdog-cron.ps1` | Windows | Installs Task Scheduler task |
| `add-task-nonstop-guard.ps1` | Windows | Helper to add watchdog task to tasks.json |
