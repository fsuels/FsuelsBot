# Auto-Save Hook - Prevents context loss
# Triggered every N tool calls to checkpoint critical files
# Part of T197: Context loss prevention

param(
    [int]$CallCount = 0,
    [int]$Threshold = 5,
    [switch]$Force,
    [switch]$Quiet
)

$workspace = "C:\dev\FsuelsBot\workspace"
$checkpointDir = "$workspace\memory\checkpoints"
$stateFile = "$workspace\memory\state.json"
$tasksFile = "$workspace\memory\tasks.json"
$threadFile = "$workspace\memory\active-thread.md"

# Ensure checkpoint directory exists
if (-not (Test-Path $checkpointDir)) {
    New-Item -ItemType Directory -Path $checkpointDir -Force | Out-Null
}

# Check if save needed
$shouldSave = $Force -or (($CallCount % $Threshold) -eq 0 -and $CallCount -gt 0)

if (-not $shouldSave) {
    if (-not $Quiet) { Write-Host "Call $CallCount - no checkpoint needed (threshold: $Threshold)" }
    exit 0
}

# Generate timestamp
$timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"

# Save checkpoints
$saved = @()

if (Test-Path $stateFile) {
    $dest = "$checkpointDir\checkpoint_${timestamp}_state.json"
    Copy-Item $stateFile $dest -Force
    $saved += "state.json"
}

if (Test-Path $tasksFile) {
    $dest = "$checkpointDir\checkpoint_${timestamp}_tasks.json"
    Copy-Item $tasksFile $dest -Force
    $saved += "tasks.json"
}

if (Test-Path $threadFile) {
    $dest = "$checkpointDir\checkpoint_${timestamp}_active-thread.md"
    Copy-Item $threadFile $dest -Force
    $saved += "active-thread.md"
}

# Cleanup old checkpoints (keep last 10 per file type)
$patterns = @("*_state.json", "*_tasks.json", "*_active-thread.md")
foreach ($pattern in $patterns) {
    $files = Get-ChildItem "$checkpointDir\checkpoint_$pattern" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending
    if ($files.Count -gt 10) {
        $files | Select-Object -Skip 10 | Remove-Item -Force
    }
}

if (-not $Quiet) {
    Write-Host "AUTO-SAVE @ call $CallCount - saved: $($saved -join ', ')"
}

# Output for parsing
@{
    call_count = $CallCount
    saved = $saved
    timestamp = $timestamp
} | ConvertTo-Json -Compress
