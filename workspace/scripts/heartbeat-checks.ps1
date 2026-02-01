<#
.SYNOPSIS
    Combined heartbeat checks - runs all checks in ONE PowerShell process
.DESCRIPTION
    PERFORMANCE IMPROVEMENT: Instead of 4 separate script invocations (each with PS startup overhead),
    run all heartbeat checks in a single process. Saves ~2+ seconds per heartbeat.
#>

param([switch]$Quiet)

$ErrorActionPreference = "SilentlyContinue"
$WORKSPACE = "C:\dev\FsuelsBot\workspace"
$results = @{}

# 1. Update health state
$healthState = @{
    status = "active"
    lastSeen = (Get-Date).ToString("o")
    pid = $PID
}
$healthState | ConvertTo-Json | Set-Content "$WORKSPACE\memory\last-healthy-state.json"
$results.healthState = "updated"

# 2. Check Mission Control (FAST - use .NET socket instead of slow Test-NetConnection)
try {
    $tcp = New-Object System.Net.Sockets.TcpClient
    $tcp.Connect("localhost", 8765)
    $tcp.Close()
    $mcRunning = $true
} catch {
    $mcRunning = $false
}
$results.missionControl = if ($mcRunning) { "running" } else { "DOWN" }

# 3. Mid-session checkpoint (inline)
$checkpointDir = "$WORKSPACE\memory\checkpoints"
if (-not (Test-Path $checkpointDir)) { New-Item -ItemType Directory -Path $checkpointDir -Force | Out-Null }

$timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$files = @("state.json", "tasks.json", "active-thread.md")
$saved = 0

foreach ($file in $files) {
    $src = "$WORKSPACE\memory\$file"
    if (Test-Path $src) {
        $dest = "$checkpointDir\checkpoint_${timestamp}_$file"
        Copy-Item $src $dest -Force
        $saved++
    }
}
$results.checkpoint = "$saved files saved"

# 4. Cleanup old checkpoints (keep last 10 per file)
foreach ($file in $files) {
    $pattern = "checkpoint_*_$file"
    $old = Get-ChildItem $checkpointDir -Filter $pattern | Sort-Object LastWriteTime -Descending | Select-Object -Skip 10
    $old | Remove-Item -Force
}

# 5. Quick error check (simplified - just count recent errors)
$clawdbotLog = "\tmp\clawdbot\clawdbot-$(Get-Date -Format 'yyyy-MM-dd').log"
$recentErrors = 0
if (Test-Path $clawdbotLog) {
    $recentErrors = (Get-Content $clawdbotLog -Tail 50 | Select-String -Pattern "Error:|failed:" | Measure-Object).Count
}
$results.recentErrors = $recentErrors

# 6. Check for unanswered discussion comments
$tasksFile = "$WORKSPACE\memory\tasks.json"
$pendingDiscussions = 0
if (Test-Path $tasksFile) {
    $tasks = Get-Content $tasksFile -Raw | ConvertFrom-Json
    foreach ($taskId in @($tasks.lanes.bot_current) + @($tasks.lanes.bot_queue)) {
        $task = $tasks.tasks.$taskId
        if ($task.discussion -and $task.discussion.Count -gt 0) {
            $lastComment = $task.discussion[-1]
            if ($lastComment.author -eq "human") { $pendingDiscussions++ }
        }
    }
}
$results.pendingDiscussions = $pendingDiscussions

# 7. ENFORCEMENT: Check for unverified completions (since verification system added ~21:00 2026-01-31)
$unverifiedCount = 0
$verificationCutoff = "2026-01-31T21:00:00"  # System added around 9 PM EST
foreach ($id in $tasks.lanes.done_today) {
    $t = $tasks.tasks.$id
    # Skip tasks completed before verification system was added
    if (-not $t.completed -or $t.completed -lt $verificationCutoff) { continue }
    # Check for missing verification
    if (-not $t.epistemic -or -not $t.epistemic.verification_status -or -not $t.epistemic.claims -or $t.epistemic.claims.Count -eq 0) {
        $unverifiedCount++
    }
}
$results.unverifiedCompletions = $unverifiedCount

# Output
if (-not $Quiet) {
    Write-Host "=== Heartbeat Checks ===" -ForegroundColor Cyan
    Write-Host "Health State: $($results.healthState)"
    Write-Host "Mission Control: $($results.missionControl)"
    Write-Host "Checkpoint: $($results.checkpoint)"
    Write-Host "Recent Errors: $($results.recentErrors)"
    Write-Host "Pending Discussions: $($results.pendingDiscussions)"
}

# Return results as JSON for programmatic use
$results | ConvertTo-Json -Compress
