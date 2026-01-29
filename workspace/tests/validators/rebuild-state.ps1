# State Reconstruction Script
# If state.json is corrupted, rebuild from events.jsonl

$workspace = "C:\dev\FsuelsBot\workspace"
$eventsFile = "$workspace\memory\events.jsonl"
$stateFile = "$workspace\memory\state.json"

Write-Host "=== State Reconstruction ===" -ForegroundColor Cyan

if (-not (Test-Path $eventsFile)) {
    Write-Host "ERROR: events.jsonl not found" -ForegroundColor Red
    exit 1
}

Write-Host "Reading events.jsonl..."
$events = Get-Content $eventsFile | ForEach-Object { $_ | ConvertFrom-Json }

Write-Host "Found $($events.Count) events" -ForegroundColor Green

# Find most recent state-related events
$stateEvents = $events | Where-Object { $_.type -in @("milestone", "task", "state_change") }
$latestTask = $events | Where-Object { $_.type -eq "task" } | Select-Object -Last 1

Write-Host ""
Write-Host "Latest events:" -ForegroundColor Yellow
$events | Select-Object -Last 5 | ForEach-Object {
    Write-Host "  [$($_.ts)] $($_.type): $($_.content)"
}

Write-Host ""
Write-Host "To rebuild state.json, manually extract:" -ForegroundColor Cyan
Write-Host "  - Current task from latest task events"
Write-Host "  - Progress from milestone events"
Write-Host "  - Standing rules from constraint events"
Write-Host ""
Write-Host "Events log is intact and can be used to reconstruct any state."
