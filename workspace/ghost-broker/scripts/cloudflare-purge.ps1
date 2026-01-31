# Cloudflare Cache Purge Script
# Usage: .\cloudflare-purge.ps1

$CF_TOKEN = "zI_1jQMQVKViC4bCfXZn6nxD02LE37ptryCEo-8z"
$ZONE_ID = "b090e74f96549775a9c3ce45c187fae2"

Write-Host "Purging Cloudflare cache for ghostbrokerai.xyz..."

$headers = @{
    "Authorization" = "Bearer $CF_TOKEN"
    "Content-Type" = "application/json"
}

$body = '{"purge_everything":true}'

$response = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/purge_cache" -Method Post -Headers $headers -Body $body

if ($response.success) {
    Write-Host "Cache purged successfully!" -ForegroundColor Green
} else {
    Write-Host "Failed to purge cache:" -ForegroundColor Red
    Write-Host ($response.errors | ConvertTo-Json)
}
