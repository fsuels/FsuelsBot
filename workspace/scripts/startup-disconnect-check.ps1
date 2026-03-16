# startup-disconnect-check.ps1
# Run automatically on Clawdbot startup to detect if previous session crashed
# If crash detected, automatically investigate and report

param(
    [string]$StateFile = "C:\dev\FsuelsBot\workspace\memory\last-healthy-state.json"
)

$Now = Get-Date
$ClawdbotLog = "\tmp\clawdbot\clawdbot-$(Get-Date -Format 'yyyy-MM-dd').log"

# Check if previous session ended cleanly
$PreviousState = $null
$CrashDetected = $false
$CrashReason = ""

if (Test-Path $StateFile) {
    try {
        $PreviousState = Get-Content $StateFile -Raw | ConvertFrom-Json
        $LastSeen = [DateTime]::Parse($PreviousState.lastSeen)
        $TimeSinceLast = $Now - $LastSeen
        
        # If last state was "active" and it's been > 2 minutes, likely a crash
        if ($PreviousState.status -eq "active" -and $TimeSinceLast.TotalMinutes -gt 2) {
            $CrashDetected = $true
            $CrashReason = "Previous session was active but ended unexpectedly ($([int]$TimeSinceLast.TotalMinutes) minutes ago)"
        }
    } catch {
        # Can't read state file, assume clean start
    }
}

# If crash detected, collect errors
if ($CrashDetected) {
    Write-Host "⚠️ CRASH DETECTED: $CrashReason" -ForegroundColor Red
    
    # Collect recent errors from log
    $Errors = @()
    if (Test-Path $ClawdbotLog) {
        $LogContent = Get-Content $ClawdbotLog -Tail 200 -ErrorAction SilentlyContinue
        $ErrorPatterns = @("UnhandledPromiseRejectionWarning", "TypeError", "AbortError", "Error:", "failed:", "ENOENT", "crash")
        
        foreach ($line in $LogContent) {
            foreach ($pattern in $ErrorPatterns) {
                if ($line -match $pattern) {
                    $Errors += $line.Trim()
                    break
                }
            }
        }
    }
    
    # Output crash report
    $Report = @{
        detected = $Now.ToString("yyyy-MM-ddTHH:mm:ssK")
        reason = $CrashReason
        lastSeen = $PreviousState.lastSeen
        errorCount = $Errors.Count
        recentErrors = $Errors | Select-Object -First 10
    }
    
    $ReportPath = "C:\dev\FsuelsBot\workspace\memory\crash-reports\$($Now.ToString('yyyy-MM-dd-HHmmss')).json"
    $ReportDir = Split-Path $ReportPath -Parent
    if (-not (Test-Path $ReportDir)) {
        New-Item -ItemType Directory -Path $ReportDir -Force | Out-Null
    }
    $Report | ConvertTo-Json -Depth 3 | Set-Content $ReportPath
    
    Write-Host "Crash report saved: $ReportPath" -ForegroundColor Yellow
    Write-Host "Errors found: $($Errors.Count)" -ForegroundColor Yellow
    
    # Return report for bot to process
    return $Report
}

# Update state to "active" for next check
$NewState = @{
    status = "active"
    lastSeen = $Now.ToString("yyyy-MM-ddTHH:mm:ssK")
    pid = $PID
}
$NewState | ConvertTo-Json | Set-Content $StateFile

Write-Host "✅ Clean startup (no crash detected)" -ForegroundColor Green
return $null
