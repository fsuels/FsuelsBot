$initBody = @{
  jsonrpc = '2.0'
  id = 1
  method = 'initialize'
  params = @{ protocolVersion='2024-11-05'; capabilities=@{}; clientInfo=@{name='openclaw'; version='0'} }
} | ConvertTo-Json -Compress -Depth 10

$init = Invoke-WebRequest -Method Post -Uri 'http://127.0.0.1:3000/mcp' -Headers @{ 'Accept'='application/json, text/event-stream' } -ContentType 'application/json' -Body $initBody -UseBasicParsing
$sid = $init.Headers['mcp-session-id']
Write-Host "SESSION: $sid"

# Send initialized notification
$notifBody = @{ jsonrpc='2.0'; method='notifications/initialized'; params=@{} } | ConvertTo-Json -Compress -Depth 4
Invoke-WebRequest -Method Post -Uri 'http://127.0.0.1:3000/mcp' -Headers @{ 'Accept'='application/json, text/event-stream'; 'mcp-session-id'=$sid } -ContentType 'application/json' -Body $notifBody -UseBasicParsing | Out-Null

# List tools
$listBody = @{ jsonrpc='2.0'; id=2; method='tools/list'; params=@{} } | ConvertTo-Json -Compress -Depth 6
$list = Invoke-WebRequest -Method Post -Uri 'http://127.0.0.1:3000/mcp' -Headers @{ 'Accept'='application/json, text/event-stream'; 'mcp-session-id'=$sid } -ContentType 'application/json' -Body $listBody -UseBasicParsing

Write-Host "CONTENT-LEN: $($list.Content.Length)" 
Write-Host "RAW-LEN: $($list.RawContentLength)"
($list.Content -split "`n" | Where-Object { $_ -like 'data:*' }) -join "`n"
