# mid-session-checkpoint.ps1
# Saves state.json and tasks.json atomically every heartbeat
# Prevents context loss from compaction/crashes
# Council A+ requirement #1 (30 min implementation)

param(
    [switch]$Force,  # Save even if no changes detected
    [switch]$Quiet   # Suppress output
)

$ErrorActionPreference = "Stop"
$workspace = "C:\dev\FsuelsBot\workspace"
$checkpointDir = "$workspace\memory\checkpoints"
$eventsLog = "$workspace\memory\events.jsonl"

# Ensure checkpoint directory exists
if (-not (Test-Path $checkpointDir)) {
    New-Item -ItemType Directory -Path $checkpointDir -Force | Out-Null
}

# Files to checkpoint
$filesToCheckpoint = @(
    "$workspace\memory\state.json",
    "$workspace\memory\tasks.json",
    "$workspace\memory\active-thread.md"
)

$timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$checkpointName = "checkpoint_$timestamp"
$savedFiles = @()

foreach ($file in $filesToCheckpoint) {
    if (Test-Path $file) {
        $fileName = Split-Path $file -Leaf
        $tempPath = "$checkpointDir\$fileName.tmp"
        $finalPath = "$checkpointDir\$checkpointName`_$fileName"
        
        # Atomic write: copy to temp, then rename
        Copy-Item -Path $file -Destination $tempPath -Force
        Move-Item -Path $tempPath -Destination $finalPath -Force
        
        $savedFiles += $fileName
    }
}

# Keep only last 10 checkpoints per file type (cleanup old ones)
$allCheckpoints = Get-ChildItem -Path $checkpointDir -Filter "checkpoint_*" | Sort-Object LastWriteTime -Descending
$checkpointGroups = $allCheckpoints | Group-Object { $_.Name -replace 'checkpoint_[\d_-]+_', '' }
foreach ($group in $checkpointGroups) {
    $toDelete = $group.Group | Select-Object -Skip 5
    foreach ($old in $toDelete) {
        Remove-Item $old.FullName -Force
    }
}

# Log checkpoint event
$eventId = "EVT-" + (Get-Date).ToString("yyyyMMdd") + "-" + (Get-Random -Minimum 100 -Maximum 999)
$event = @{
    ts = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ssK")
    id = $eventId
    type = "mid_session_checkpoint"
    priority = "P3"
    content = "Mid-session checkpoint saved: $($savedFiles -join ', ')"
    tags = @("checkpoint", "state-preservation")
    session = "heartbeat"
} | ConvertTo-Json -Compress

Add-Content -Path $eventsLog -Value $event

if (-not $Quiet) {
    Write-Host "=== Mid-Session Checkpoint ===" -ForegroundColor Cyan
    Write-Host "Timestamp: $timestamp"
    Write-Host "Saved: $($savedFiles -join ', ')"
    Write-Host "Location: $checkpointDir"
    Write-Host "Event logged: $eventId"
}

# Return success
exit 0
