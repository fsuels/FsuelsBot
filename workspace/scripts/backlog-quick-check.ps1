# Backlog Quick Check - Heartbeat supplement
# Checks for urgent opportunities without full scan
# Usage: powershell -ExecutionPolicy Bypass -File scripts/backlog-quick-check.ps1

param(
    [switch]$Quiet
)

$ErrorActionPreference = "SilentlyContinue"
$workspace = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$today = Get-Date -Format "yyyy-MM-dd"

$result = @{
    needsSeasonalScan = $false
    needsErrorScan = $false
    highPriorityPending = @()
    lastRunDate = $null
}

# Check if backlog generator ran today
$reportPath = Join-Path $workspace "memory/backlog-reports/$today.json"
if (Test-Path $reportPath) {
    $report = Get-Content $reportPath -Raw | ConvertFrom-Json
    $result.lastRunDate = $report.run_date
} else {
    if (-not $Quiet) { Write-Host "⚠️ No backlog report for today - cron may not have run" }
}

# Quick seasonal check - any events within 7 days?
$seasonalEvents = @(
    @{name="Valentine's Day"; month=2; day=14; prep=14},
    @{name="Easter"; month=4; day=20; prep=21},
    @{name="Mother's Day"; month=5; day=10; prep=21},
    @{name="Father's Day"; month=6; day=21; prep=21},
    @{name="4th of July"; month=7; day=4; prep=14},
    @{name="Back to School"; month=8; day=1; prep=30},
    @{name="Halloween"; month=10; day=31; prep=30},
    @{name="Thanksgiving"; month=11; day=27; prep=21},
    @{name="Black Friday"; month=11; day=28; prep=30},
    @{name="Christmas"; month=12; day=25; prep=45}
)

$now = Get-Date
foreach ($event in $seasonalEvents) {
    $eventDate = Get-Date -Year $now.Year -Month $event.month -Day $event.day
    if ($eventDate -lt $now) {
        $eventDate = $eventDate.AddYears(1)
    }
    $daysUntil = ($eventDate - $now).Days
    $prepDeadline = $daysUntil - $event.prep
    
    if ($prepDeadline -le 7 -and $daysUntil -gt 0 -and $daysUntil -le 60) {
        $result.needsSeasonalScan = $true
        if (-not $Quiet) { Write-Host "🎯 Seasonal urgency: $($event.name) in $daysUntil days (prep deadline in $prepDeadline days)" }
    }
}

# Quick error check - any recent error spikes?
$errorLogPath = Join-Path $workspace "memory/error-log-archive-*.jsonl"
$recentErrors = Get-ChildItem $errorLogPath -ErrorAction SilentlyContinue | 
    Where-Object { $_.LastWriteTime -gt (Get-Date).AddHours(-24) }

if ($recentErrors.Count -gt 0) {
    $errorCount = 0
    foreach ($log in $recentErrors) {
        $lines = Get-Content $log.FullName -ErrorAction SilentlyContinue
        $errorCount += $lines.Count
    }
    if ($errorCount -ge 3) {
        $result.needsErrorScan = $true
        if (-not $Quiet) { Write-Host "⚠️ Error spike: $errorCount errors in last 24h" }
    }
}

# Check for high-priority auto-generated tasks not yet executed
$tasksPath = Join-Path $workspace "memory/tasks.json"
if (Test-Path $tasksPath) {
    $tasks = Get-Content $tasksPath -Raw | ConvertFrom-Json
    $botQueue = $tasks.lanes.bot_queue
    
    foreach ($taskId in $botQueue) {
        $task = $tasks.tasks.$taskId
        if ($task -and $task.auto_generated -eq $true -and $task.score -ge 15 -and $task.status -eq "pending") {
            $result.highPriorityPending += @{
                id = $taskId
                title = $task.title
                score = $task.score
                agent_type = $task.agent_type
            }
        }
    }
    
    if ($result.highPriorityPending.Count -gt 0 -and -not $Quiet) {
        Write-Host "🚨 High-priority auto-tasks pending: $($result.highPriorityPending.Count)"
        foreach ($t in $result.highPriorityPending) {
            Write-Host "   [$($t.id)] $($t.title) (score: $($t.score))"
        }
    }
}

# Output JSON for programmatic use
if ($Quiet) {
    $result | ConvertTo-Json -Depth 3
}
