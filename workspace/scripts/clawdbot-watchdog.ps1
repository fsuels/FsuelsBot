# Clawdbot Watchdog — Auto-restart on crash
# Run this in a separate PowerShell window:
#   powershell -ExecutionPolicy Bypass -File C:\dev\FsuelsBot\workspace\scripts\clawdbot-watchdog.ps1
#
# Or set up as a Windows Scheduled Task for true always-on

$checkInterval = 30  # seconds between checks
$logFile = "C:\dev\FsuelsBot\workspace\logs\watchdog.log"

# Create logs directory
if (!(Test-Path "C:\dev\FsuelsBot\workspace\logs")) {
    New-Item -ItemType Directory -Path "C:\dev\FsuelsBot\workspace\logs" | Out-Null
}

function Write-Log($msg) {
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    "$ts  $msg" | Tee-Object -FilePath $logFile -Append
}

Write-Log "Watchdog started. Checking every ${checkInterval}s."

while ($true) {
    try {
        # Check if clawdbot gateway is responding
        $response = Invoke-RestMethod -Uri "http://127.0.0.1:18789/health" -TimeoutSec 5 -ErrorAction Stop
        # Gateway is up
    }
    catch {
        Write-Log "Gateway not responding! Attempting restart..."
        try {
            # Try graceful restart first
            & clawdbot gateway restart 2>&1 | Out-Null
            Write-Log "Restart command sent. Waiting 15s..."
            Start-Sleep -Seconds 15
            
            # Verify it came back
            try {
                $response = Invoke-RestMethod -Uri "http://127.0.0.1:18789/health" -TimeoutSec 5 -ErrorAction Stop
                Write-Log "Gateway restarted successfully!"
            }
            catch {
                Write-Log "Gateway still down after restart. May need manual intervention."
            }
        }
        catch {
            Write-Log "Restart failed: $_"
        }
    }
    
    Start-Sleep -Seconds $checkInterval
}
