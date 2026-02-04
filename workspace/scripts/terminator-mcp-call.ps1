param(
  [Parameter(Mandatory=$true)][string]$Tool,
  [Parameter(Mandatory=$false)][string]$ArgsJson = "{}"
)

function Ensure-TerminatorHealthy {
  try {
    $h = Invoke-RestMethod -Uri 'http://127.0.0.1:3000/health' -TimeoutSec 2
    return ($h.status -eq 'healthy')
  } catch {
    return $false
  }
}

function Start-TerminatorAgent {
  # Best-effort: start in background; if already running, this is a no-op.
  try {
    Start-Process -WindowStyle Hidden -FilePath "C:\Users\Fsuels\AppData\Roaming\npm\npx.cmd" -ArgumentList @('-y','terminator-mcp-agent@latest','--transport','http','--port','3000') | Out-Null
  } catch {}
}

function New-McpSession {
  if (-not (Ensure-TerminatorHealthy)) {
    Start-TerminatorAgent
    Start-Sleep -Seconds 2
    if (-not (Ensure-TerminatorHealthy)) {
      throw 'Terminator MCP agent not reachable on 127.0.0.1:3000'
    }
  }

  $initBody = @{ jsonrpc='2.0'; id=1; method='initialize'; params=@{ protocolVersion='2024-11-05'; capabilities=@{}; clientInfo=@{ name='openclaw'; version='0' } } } | ConvertTo-Json -Compress -Depth 10
  $init = Invoke-WebRequest -Method Post -Uri 'http://127.0.0.1:3000/mcp' -Headers @{ 'Accept'='application/json, text/event-stream' } -ContentType 'application/json' -Body $initBody -UseBasicParsing
  $sid = $init.Headers['mcp-session-id']
  $notifBody = @{ jsonrpc='2.0'; method='notifications/initialized'; params=@{} } | ConvertTo-Json -Compress -Depth 4
  Invoke-WebRequest -Method Post -Uri 'http://127.0.0.1:3000/mcp' -Headers @{ 'Accept'='application/json, text/event-stream'; 'mcp-session-id'=$sid } -ContentType 'application/json' -Body $notifBody -UseBasicParsing | Out-Null
  return $sid
}

function Invoke-Mcp($sid, $payloadObj) {
  $body = ($payloadObj | ConvertTo-Json -Compress -Depth 30)
  $r = Invoke-WebRequest -Method Post -Uri 'http://127.0.0.1:3000/mcp' -Headers @{ 'Accept'='application/json, text/event-stream'; 'mcp-session-id'=$sid } -ContentType 'application/json' -Body $body -UseBasicParsing
  # extract data lines and strip leading "data: "
  $lines = $r.Content -split "`n" | Where-Object { $_ -like 'data:*' }
  return ($lines | ForEach-Object { $_.Substring(6) })
}

$sid = New-McpSession
if (Test-Path $ArgsJson) {
  $args = (Get-Content $ArgsJson -Raw) | ConvertFrom-Json
} else {
  $args = $ArgsJson | ConvertFrom-Json
}

$payload = @{ jsonrpc='2.0'; id=2; method='tools/call'; params=@{ name=$Tool; arguments=$args } }
$dataLines = Invoke-Mcp -sid $sid -payloadObj $payload
$dataLines -join "`n"
