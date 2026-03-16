# nonstop-guard.ps1 — watchdog helper
# Purpose: detect when bot_current appears stalled (no task updates beyond threshold)
# Output: single-line JSON (last line) with stalled=true/false and evidence fields.

param(
  [int]$ThresholdMinutes = 10,
  [string]$TasksPath = "C:\dev\FsuelsBot\workspace\memory\tasks.json"
)

$ErrorActionPreference = 'Stop'

function Get-IsoOrNull($s) {
  if ([string]::IsNullOrWhiteSpace($s)) { return $null }
  try { return [DateTimeOffset]::Parse($s) } catch { return $null }
}

$now = [DateTimeOffset]::UtcNow

if (-not (Test-Path $TasksPath)) {
  $out = [ordered]@{
    ok = $false
    reason = 'tasks.json not found'
    tasksPath = $TasksPath
    stalled = $false
    timestampUtc = $now.ToString('o')
  }
  $out | ConvertTo-Json -Compress
  exit 1
}

$tasks = Get-Content $TasksPath -Raw | ConvertFrom-Json
$botCurrent = @($tasks.lanes.bot_current)

if ($botCurrent.Count -eq 0) {
  $out = [ordered]@{
    ok = $true
    stalled = $false
    botCurrentCount = 0
    timestampUtc = $now.ToString('o')
  }
  $out | ConvertTo-Json -Compress
  exit 0
}

$topId = [string]$botCurrent[0]
$task = $tasks.tasks.$topId

# choose a timestamp to judge activity
$tsCandidates = @(
  $task.updated_at,
  $task.completed_at,
  $task.started_at,
  $tasks.updated_at
) | Where-Object { $_ }

$last = $null
foreach ($c in $tsCandidates) {
  $p = Get-IsoOrNull $c
  if ($p -and (-not $last -or $p -gt $last)) { $last = $p }
}

$minutesSince = $null
$stalled = $false
if ($last) {
  $minutesSince = [Math]::Round(($now - $last).TotalMinutes, 2)
  $stalled = ($minutesSince -ge $ThresholdMinutes)
} else {
  # if we can't parse any timestamp, treat as suspicious but not stalled
  $stalled = $false
}

# Best-effort recovery if stalled: ensure Mission Control is reachable
$recovery = [ordered]@{ attempted = $false; missionControl = $null; scheduledTask = $null; errors = @() }

if ($stalled) {
  $recovery.attempted = $true
  try {
    $resp = Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:8765/' -TimeoutSec 5
    $recovery.missionControl = "ok:$($resp.StatusCode)"
  } catch {
    $recovery.missionControl = 'down'
    try {
      $t = Get-ScheduledTask -TaskName 'MissionControlServer' -ErrorAction Stop
      Start-ScheduledTask -TaskName 'MissionControlServer'
      $recovery.scheduledTask = 'MissionControlServer started'
    } catch {
      $recovery.errors += ("MissionControl restart failed: " + $_.Exception.Message)
    }
  }
}

$out = [ordered]@{
  ok = $true
  stalled = $stalled
  thresholdMinutes = $ThresholdMinutes
  botCurrentCount = $botCurrent.Count
  topTaskId = $topId
  topTaskStatus = $task.status
  lastActivityUtc = if ($last) { $last.ToString('o') } else { $null }
  minutesSinceLastActivity = $minutesSince
  recovery = $recovery
  timestampUtc = $now.ToString('o')
}

$out | ConvertTo-Json -Compress
