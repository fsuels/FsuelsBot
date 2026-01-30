$body = @{agentName='NexusAI'} | ConvertTo-Json
try {
    $response = Invoke-RestMethod -Uri 'https://www.moltbook.com/api/register-agent' -Method Post -Body $body -ContentType 'application/json'
    $response | ConvertTo-Json -Depth 5
} catch {
    Write-Host "Error: $($_.Exception.Message)"
    Write-Host "Status: $($_.Exception.Response.StatusCode)"
    if ($_.ErrorDetails.Message) {
        Write-Host "Details: $($_.ErrorDetails.Message)"
    }
}
