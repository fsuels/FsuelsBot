# Browser Health Check & Auto-Recovery Script
# Checks if browser control server is responsive and suggests recovery

param(
    [switch]$Quiet
)

$controlUrl = "http://127.0.0.1:18791"
$cdpUrl = "http://127.0.0.1:18800"

function Test-UrlHealth {
    param($url, $timeoutSec = 5)
    try {
        $response = Invoke-WebRequest -Uri $url -TimeoutSec $timeoutSec -ErrorAction Stop
        return @{ healthy = $true; status = $response.StatusCode }
    } catch {
        return @{ healthy = $false; error = $_.Exception.Message }
    }
}

if (-not $Quiet) {
    Write-Host "=== Browser Health Check ===" -ForegroundColor Cyan
}

# Check CDP endpoint (Chrome DevTools Protocol)
$cdpHealth = Test-UrlHealth "$cdpUrl/json/version"

# Check control server
$controlHealth = Test-UrlHealth "$controlUrl/status" 10

$issues = @()

if (-not $cdpHealth.healthy) {
    $issues += "CDP endpoint not responding"
}

if (-not $controlHealth.healthy) {
    $issues += "Control server not responding (timeout)"
}

if ($issues.Count -eq 0) {
    if (-not $Quiet) {
        Write-Host "✅ Browser control healthy" -ForegroundColor Green
        Write-Host "  CDP: $cdpUrl" -ForegroundColor Gray
        Write-Host "  Control: $controlUrl" -ForegroundColor Gray
    }
    exit 0
} else {
    Write-Host "⚠️ Browser control issues detected:" -ForegroundColor Yellow
    $issues | ForEach-Object { Write-Host "  - $_" -ForegroundColor Yellow }
    
    Write-Host ""
    Write-Host "🔧 Recovery options:" -ForegroundColor Cyan
    Write-Host "  1. Restart Clawdbot gateway: clawdbot gateway restart" -ForegroundColor White
    Write-Host "  2. Close and reopen Chrome browser" -ForegroundColor White
    Write-Host "  3. Kill stale Chrome processes:" -ForegroundColor White
    Write-Host "     Get-Process chrome* | Stop-Process -Force" -ForegroundColor Gray
    Write-Host "  4. Re-run: clawdbot gateway start" -ForegroundColor White
    
    # Output for automation
    Write-Output 'BROWSER_UNHEALTHY'
    exit 1
}
