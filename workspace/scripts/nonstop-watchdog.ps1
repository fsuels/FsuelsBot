<#
.SYNOPSIS
    Anti-idle watchdog for Clawdbot/Moltbot agent
.DESCRIPTION
    Detects when the bot has been idle despite having tasks in bot_current.
    Sends Telegram alert and attempts auto-recovery.
.PARAMETER MaxIdleMinutes
    Maximum minutes of inactivity before alerting (default: 10)
.PARAMETER TelegramAlert
    Send alert to Telegram when idle detected (default: true)
#>

param(
    [int]$MaxIdleMinutes = 10,
    [switch]$TelegramAlert = $true,
    [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
$workspaceDir = Split-Path $PSScriptRoot -Parent
$tasksPath = Join-Path $workspaceDir 'memory\tasks.json'
$healthStatePath = Join-Path $workspaceDir 'memory\last-healthy-state.json'
$watchdogStatePath = Join-Path $workspaceDir 'memory\watchdog-state.json'

function Write-Log {
    param([string]$Message, [string]$Level = 'INFO')
    if (-not $Quiet) {
        $ts = (Get-Date).ToString('HH:mm:ss')
        Write-Host "[$ts] [$Level] $Message"
    }
}

function Get-TasksInBotCurrent {
    if (-not (Test-Path $tasksPath)) { return @() }
    $raw = Get-Content $tasksPath -Raw -Encoding UTF8
    if ($raw.Length -gt 0 -and $raw[0] -eq [char]0xFEFF) { $raw = $raw.Substring(1) }
    $data = $raw | ConvertFrom-Json
    $botCurrent = $data.lanes.bot_current
    if (-not $botCurrent) { return @() }
    return @($botCurrent)
}

function Get-LastActivityTime {
    # Check multiple sources for last activity
    $times = @()

    # 1. Check last-healthy-state.json
    if (Test-Path $healthStatePath) {
        $health = Get-Content $healthStatePath -Raw | ConvertFrom-Json
        if ($health.lastSeen) {
            $times += [DateTime]::Parse($health.lastSeen)
        }
    }

    # 2. Check tasks.json updated_at
    if (Test-Path $tasksPath) {
        $raw = Get-Content $tasksPath -Raw -Encoding UTF8
        if ($raw.Length -gt 0 -and $raw[0] -eq [char]0xFEFF) { $raw = $raw.Substring(1) }
        $tasks = $raw | ConvertFrom-Json
        if ($tasks.updated_at) {
            $times += [DateTime]::Parse($tasks.updated_at)
        }
    }

    # 3. Check recent memory files
    $memoryDir = Join-Path $workspaceDir 'memory'
    $recentFiles = Get-ChildItem $memoryDir -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 5
    foreach ($f in $recentFiles) {
        $times += $f.LastWriteTime
    }

    if ($times.Count -eq 0) { return $null }
    return ($times | Sort-Object -Descending | Select-Object -First 1)
}

function Send-TelegramAlert {
    param([string]$Message)
    if (-not $TelegramAlert) { return }

    try {
        # Use moltbot CLI to send
        & moltbot send telegram "$Message" 2>$null
        Write-Log "Telegram alert sent" 'WARN'
    } catch {
        Write-Log "Failed to send Telegram alert: $_" 'ERROR'
    }
}

function Save-WatchdogState {
    param(
        [DateTime]$CheckedAt,
        [bool]$IdleDetected,
        [int]$TaskCount
    )
    $state = @{
        checkedAt = $CheckedAt.ToString('o')
        idleDetected = $IdleDetected
        taskCount = $TaskCount
        maxIdleMinutes = $MaxIdleMinutes
    }
    $state | ConvertTo-Json | Set-Content $watchdogStatePath -Encoding UTF8
}

# Main execution
$now = Get-Date
$tasks = Get-TasksInBotCurrent
$taskCount = $tasks.Count

Write-Log "Watchdog check: $taskCount tasks in bot_current"

if ($taskCount -eq 0) {
    Write-Log "No tasks in bot_current - all clear"
    Save-WatchdogState -CheckedAt $now -IdleDetected $false -TaskCount 0

    $result = @{
        status = 'ok'
        message = 'No tasks pending'
        taskCount = 0
    }
    return ($result | ConvertTo-Json -Compress)
}

# Tasks exist - check for idle
$lastActivity = Get-LastActivityTime
if (-not $lastActivity) {
    Write-Log "Could not determine last activity time" 'WARN'
    Save-WatchdogState -CheckedAt $now -IdleDetected $false -TaskCount $taskCount

    $result = @{
        status = 'unknown'
        message = 'Could not determine last activity'
        taskCount = $taskCount
    }
    return ($result | ConvertTo-Json -Compress)
}

$idleMinutes = [math]::Round(($now - $lastActivity).TotalMinutes, 1)
Write-Log "Last activity: $($lastActivity.ToString('HH:mm:ss')) ($idleMinutes min ago)"

if ($idleMinutes -gt $MaxIdleMinutes) {
    Write-Log "IDLE DETECTED: $idleMinutes minutes with $taskCount tasks pending" 'WARN'

    # Get first task title for context
    $raw = Get-Content $tasksPath -Raw -Encoding UTF8
    if ($raw.Length -gt 0 -and $raw[0] -eq [char]0xFEFF) { $raw = $raw.Substring(1) }
    $data = $raw | ConvertFrom-Json
    $firstTaskId = $tasks[0]
    $firstTask = $data.tasks.$firstTaskId
    $taskTitle = if ($firstTask.title) { $firstTask.title } else { "Unknown task" }

    # Send alert
    $alertMsg = @"
🚨 IDLE ALERT

Bot has been idle for $idleMinutes minutes with $taskCount tasks pending.

Next task: [$firstTaskId] $taskTitle

Action required: Resume execution or investigate blocker.
"@

    Send-TelegramAlert -Message $alertMsg
    Save-WatchdogState -CheckedAt $now -IdleDetected $true -TaskCount $taskCount

    $result = @{
        status = 'idle'
        message = "Idle for $idleMinutes minutes with $taskCount tasks"
        taskCount = $taskCount
        idleMinutes = $idleMinutes
        nextTask = $firstTaskId
        alertSent = $TelegramAlert
    }
    return ($result | ConvertTo-Json -Compress)
}

# Active enough
Write-Log "Activity within threshold ($idleMinutes < $MaxIdleMinutes min)"
Save-WatchdogState -CheckedAt $now -IdleDetected $false -TaskCount $taskCount

$result = @{
    status = 'active'
    message = "Active with $taskCount tasks"
    taskCount = $taskCount
    idleMinutes = $idleMinutes
}
return ($result | ConvertTo-Json -Compress)
