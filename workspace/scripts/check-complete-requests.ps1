# check-complete-requests.ps1
# Monitors memory/complete-requests/ for stale verification requests
# Alerts via Telegram if any request is older than the threshold

param(
    [int]$StaleMinutes = 30
)

$requestsDir = "C:\dev\FsuelsBot\workspace\memory\complete-requests"
$now = Get-Date

# Ensure directory exists
if (-not (Test-Path $requestsDir)) {
    New-Item -ItemType Directory -Path $requestsDir -Force | Out-Null
    exit 0
}

# Get all pending request files
$requests = Get-ChildItem -Path $requestsDir -Filter "*.json" -ErrorAction SilentlyContinue

if ($requests.Count -eq 0) {
    # No pending requests - all good
    exit 0
}

$staleRequests = @()

foreach ($file in $requests) {
    $content = Get-Content $file.FullName -Raw | ConvertFrom-Json
    $requestedAt = [DateTime]::Parse($content.requestedAt)
    $ageMinutes = ($now - $requestedAt).TotalMinutes
    
    if ($ageMinutes -gt $StaleMinutes) {
        $staleRequests += @{
            taskId = $content.taskId
            ageMinutes = [math]::Round($ageMinutes, 0)
            file = $file.Name
        }
    }
}

if ($staleRequests.Count -gt 0) {
    # Output for cron job to pick up and alert
    $taskList = ($staleRequests | ForEach-Object { "$($_.taskId) ($($_.ageMinutes)m old)" }) -join ", "
    Write-Output "STALE_REQUESTS: $taskList"
    exit 1
}

exit 0
