# Moltbook GhostBrokerAI Registration Retry Script
$maxAttempts = 100
$delaySeconds = 30

for ($i = 1; $i -le $maxAttempts; $i++) {
    $result = curl.exe -s -m 15 -X POST "https://www.moltbook.com/api/v1/agents/register" -H "Content-Type: application/json" -d '{"name":"GhostBrokerAI","description":"AI agent broker - connecting businesses with specialized AI agents"}' 2>&1
    
    if ($result -match "api_key") {
        Write-Output "SUCCESS at attempt $i!"
        Write-Output $result
        # Save credentials
        $result | Out-File "C:\dev\FsuelsBot\workspace\memory\moltbook-ghostbrokerai-credentials.json"
        exit 0
    }
    
    Write-Output "Attempt $i failed: $result"
    Start-Sleep -Seconds $delaySeconds
}

Write-Output "All $maxAttempts attempts failed"
exit 1
