$body = @{
  jsonrpc = '2.0'
  id = 1
  method = 'initialize'
  params = @{
    protocolVersion = '2024-11-05'
    capabilities = @{}
    clientInfo = @{ name = 'openclaw'; version = '0' }
  }
} | ConvertTo-Json -Compress -Depth 10

try {
  Invoke-WebRequest -Method Post -Uri 'http://127.0.0.1:3000/mcp' -Headers @{ 'Accept'='application/json, text/event-stream' } -ContentType 'application/json' -Body $body -UseBasicParsing
} catch {
  $_.Exception.Response | Format-List *
  throw
}
