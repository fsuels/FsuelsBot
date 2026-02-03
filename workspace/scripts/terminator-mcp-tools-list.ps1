$sid = '64d7c5f3-7e7f-4dea-9773-5b7049eee95c'
$body = @{ jsonrpc='2.0'; id=2; method='tools/list'; params=@{} } | ConvertTo-Json -Compress -Depth 6
$r = Invoke-WebRequest -Method Post -Uri 'http://127.0.0.1:3000/mcp' -Headers @{ 'Accept'='application/json, text/event-stream'; 'mcp-session-id'=$sid } -ContentType 'application/json' -Body $body -UseBasicParsing
$r.RawContent
