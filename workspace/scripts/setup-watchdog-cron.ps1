<#
.SYNOPSIS
    Sets up a Windows Task Scheduler task to run the nonstop watchdog every 5 minutes
#>

$ErrorActionPreference = 'Stop'

$taskName = "MoltbotNonstopWatchdog"
$scriptPath = Join-Path $PSScriptRoot "nonstop-watchdog.ps1"

# Remove existing task if present
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host "Removed existing task: $taskName"
}

# Create trigger: every 5 minutes
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 5)

# Create action
$action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-ExecutionPolicy Bypass -WindowStyle Hidden -File `"$scriptPath`" -Quiet"

# Create settings
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RunOnlyIfNetworkAvailable:$false

# Register task
Register-ScheduledTask `
    -TaskName $taskName `
    -Trigger $trigger `
    -Action $action `
    -Settings $settings `
    -Description "Monitors Moltbot for idle states and sends alerts when tasks are pending but not being worked on" `
    -RunLevel Limited

Write-Host "✅ Scheduled task '$taskName' created successfully!"
Write-Host "   - Runs every 5 minutes"
Write-Host "   - Alerts if idle >10 minutes with pending tasks"
Write-Host ""
Write-Host "To test manually: powershell -File `"$scriptPath`""
