param(
  [int]$ThresholdMinutes = 10,
  [int]$PortMissionControl = 8765,
  [int]$PortTerminator = 3000,
  [string]$RepoRoot = "C:\\dev\\FsuelsBot",
  [string]$WorkspaceRoot = "C:\\dev\\FsuelsBot\\workspace",
  [string]$TerminatorExecDir = "C:\\Users\\Fsuels\\AppData\\Local\\mediar\\executions",
  [switch]$Recover,
  [switch]$SimulateMissionControlDown,
  [switch]$SimulateTerminatorDown,
  [switch]$SimulateStall
)

$ErrorActionPreference = 'SilentlyContinue'

function Get-LatestFileTime($dir, $filter) {
  if (!(Test-Path $dir)) { return $null }
  $f = Get-ChildItem -Path $dir -Filter $filter -File | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
  if ($null -eq $f) { return $null }
  return $f.LastWriteTimeUtc
}

function Get-GitLastCommitTimeUtc($repo) {
  try {
    $out = cmd /c "cd /d $repo && git log -1 --format=%cI" 2>$null
    if ($out) { return [datetime]::Parse($out).ToUniversalTime() }
  } catch {}
  return $null
}

function Read-TasksMeta($path) {
  try {
    $raw = Get-Content $path -Raw -Encoding UTF8
    if ($raw.Length -gt 0 -and $raw[0] -eq [char]0xFEFF) { $raw = $raw.Substring(1) }
    $obj = $raw | ConvertFrom-Json
    return $obj
  } catch {
    return $null
  }
}

$now = (Get-Date).ToUniversalTime()
$threshold = $now.AddMinutes(-1 * $ThresholdMinutes)

$tasksPath = Join-Path $WorkspaceRoot 'memory\\tasks.json'
$tasks = Read-TasksMeta $tasksPath
$botCurrent = @()
$tasksUpdatedUtc = $null
if ($tasks) {
  $botCurrent = @($tasks.lanes.bot_current)
  try { $tasksUpdatedUtc = [datetime]::Parse($tasks.updated_at).ToUniversalTime() } catch {}
}

$latestShotUtc = Get-LatestFileTime $TerminatorExecDir '*mcp*_window*.jpg'
$latestTsUtc = Get-LatestFileTime $TerminatorExecDir '*standalone_full_*.ts'
$gitUtc = Get-GitLastCommitTimeUtc $RepoRoot

# Determine last evidence timestamp
$times = @($tasksUpdatedUtc, $latestShotUtc, $latestTsUtc, $gitUtc) | Where-Object { $_ -ne $null }
$lastEvidenceUtc = $null
if ($times.Count -gt 0) { $lastEvidenceUtc = ($times | Sort-Object -Descending | Select-Object -First 1) }

$missionControlListening = $false
try {
  $missionControlListening = [bool](Get-NetTCPConnection -LocalPort $PortMissionControl -State Listen -ErrorAction SilentlyContinue)
} catch {}

$terminatorHealthy = $false
try {
  $h = curl.exe -s "http://127.0.0.1:$PortTerminator/health" 2>$null
  if ($h -and $h -match 'healthy') { $terminatorHealthy = $true }
} catch {}

if ($SimulateMissionControlDown) { $missionControlListening = $false }
if ($SimulateTerminatorDown) { $terminatorHealthy = $false }

$stalled = $false
if ($botCurrent.Count -gt 0) {
  if ($lastEvidenceUtc -eq $null) { $stalled = $true }
  elseif ($lastEvidenceUtc -lt $threshold) { $stalled = $true }
}
if ($SimulateStall) { $stalled = $true }

$recoveryActions = @()
if ($Recover -and $botCurrent.Count -gt 0) {
  if (-not $missionControlListening) {
    try {
      Start-ScheduledTask -TaskName "MissionControlServer" | Out-Null
      $recoveryActions += "Started scheduled task MissionControlServer"
      Start-Sleep -Seconds 2
      $missionControlListening = [bool](Get-NetTCPConnection -LocalPort $PortMissionControl -State Listen -ErrorAction SilentlyContinue)
    } catch {
      $recoveryActions += "Failed to start MissionControlServer"
    }
  }
  if (-not $terminatorHealthy) {
    try {
      # start Terminator MCP server in http mode (local only)
      cmd /c "start \"\" npx -y terminator-mcp-agent@latest --transport http --port 3000" | Out-Null
      $recoveryActions += "Started Terminator MCP (npx http :3000)"
      Start-Sleep -Seconds 3
      $h2 = curl.exe -s "http://127.0.0.1:$PortTerminator/health" 2>$null
      if ($h2 -and $h2 -match 'healthy') { $terminatorHealthy = $true }
    } catch {
      $recoveryActions += "Failed to start Terminator"
    }
  }
}

$result = [ordered]@{
  nowUtc = $now.ToString('o')
  thresholdMinutes = $ThresholdMinutes
  botCurrentCount = $botCurrent.Count
  botCurrent = $botCurrent
  lastEvidenceUtc = if ($lastEvidenceUtc) { $lastEvidenceUtc.ToString('o') } else { $null }
  tasksUpdatedUtc = if ($tasksUpdatedUtc) { $tasksUpdatedUtc.ToString('o') } else { $null }
  latestTerminatorScreenshotUtc = if ($latestShotUtc) { $latestShotUtc.ToString('o') } else { $null }
  latestTerminatorStandaloneUtc = if ($latestTsUtc) { $latestTsUtc.ToString('o') } else { $null }
  lastGitCommitUtc = if ($gitUtc) { $gitUtc.ToString('o') } else { $null }
  missionControlListening = $missionControlListening
  terminatorHealthy = $terminatorHealthy
  stalled = $stalled
  recoverEnabled = [bool]$Recover
  recoveryActions = $recoveryActions
}

$result | ConvertTo-Json -Compress
