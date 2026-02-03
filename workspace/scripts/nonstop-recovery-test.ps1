param(
  [int]$PortMissionControl = 8765,
  [int]$PortTerminator = 3000
)

$ErrorActionPreference = 'Stop'

function Get-ListeningPid($port) {
  $line = (netstat -ano | Select-String (":$port") | Select-String 'LISTENING' | Select-Object -First 1).Line
  if (-not $line) { return $null }
  $parts = $line -split '\s+'
  return [int]$parts[-1]
}

function Test-Http($url) {
  try {
    $resp = curl.exe -s $url
    return $resp
  } catch { return $null }
}

$pre = [ordered]@{
  mcPid = Get-ListeningPid $PortMissionControl
  terminatorHealth = Test-Http "http://127.0.0.1:$PortTerminator/health"
}

# 1) Simulate Mission Control down
$mcPid = $pre.mcPid
if ($mcPid) {
  Stop-Process -Id $mcPid -Force
  Start-Sleep -Seconds 1
}
Start-ScheduledTask -TaskName 'MissionControlServer'
Start-Sleep -Seconds 2

$postMcPid = Get-ListeningPid $PortMissionControl

# 2) Simulate Terminator down (HTTP transport)
$tPid = Get-ListeningPid $PortTerminator
if ($tPid) {
  Stop-Process -Id $tPid -Force
  Start-Sleep -Seconds 1
}
# Restart terminator in background
cmd /c "start \"\" npx -y terminator-mcp-agent@latest --transport http --port 3000"
Start-Sleep -Seconds 3

$postTerm = Test-Http "http://127.0.0.1:$PortTerminator/health"

$result = [ordered]@{
  pre = $pre
  post = @{ mcPid = $postMcPid; terminatorHealth = $postTerm }
}

$result | ConvertTo-Json -Compress
