<#
.SYNOPSIS
    Archive completed tasks older than N days to reduce tasks.json bloat
.DESCRIPTION
    Moves tasks from done_today to archive file if completed > N days ago.
    Keeps last 20 completed tasks in main file for visibility.
#>

param(
    [int]$DaysOld = 7,
    [int]$KeepRecent = 20,
    [switch]$DryRun
)

$WORKSPACE = "C:\dev\FsuelsBot\workspace"
$TasksFile = "$WORKSPACE\memory\tasks.json"
$ArchiveFile = "$WORKSPACE\memory\tasks-archive.jsonl"

$tasks = Get-Content $TasksFile -Raw | ConvertFrom-Json
$now = Get-Date

$toArchive = @()
$toKeep = @()
$cutoffDate = $now.AddDays(-$DaysOld)

# Sort done_today by completion date (newest first)
$doneTasks = foreach ($id in $tasks.lanes.done_today) {
    $t = $tasks.tasks.$id
    if ($t.completed) {
        [PSCustomObject]@{
            Id = $id
            CompletedAt = [DateTime]::Parse($t.completed)
            Task = $t
        }
    } else {
        # No completion date - keep it
        [PSCustomObject]@{
            Id = $id
            CompletedAt = $now
            Task = $t
        }
    }
}

$sorted = $doneTasks | Sort-Object CompletedAt -Descending

# Keep the most recent N
$kept = 0
foreach ($item in $sorted) {
    if ($kept -lt $KeepRecent) {
        $toKeep += $item.Id
        $kept++
    } elseif ($item.CompletedAt -lt $cutoffDate) {
        $toArchive += $item
    } else {
        $toKeep += $item.Id
    }
}

Write-Host "=== Archive Old Tasks ===" -ForegroundColor Cyan
Write-Host "Cutoff: $($cutoffDate.ToString('yyyy-MM-dd'))"
Write-Host "Keeping: $($toKeep.Count) tasks"
Write-Host "Archiving: $($toArchive.Count) tasks"

if ($toArchive.Count -eq 0) {
    Write-Host "Nothing to archive." -ForegroundColor Green
    exit 0
}

if ($DryRun) {
    Write-Host "`n[DRY RUN] Would archive:" -ForegroundColor Yellow
    foreach ($item in $toArchive) {
        Write-Host "  $($item.Id): $($item.Task.title)"
    }
    exit 0
}

# Archive tasks
foreach ($item in $toArchive) {
    $archiveEntry = @{
        id = $item.Id
        archived_at = $now.ToString("o")
        task = $item.Task
    } | ConvertTo-Json -Compress -Depth 10
    Add-Content -Path $ArchiveFile -Value $archiveEntry
    
    # Remove from tasks object
    $tasks.tasks.PSObject.Properties.Remove($item.Id)
}

# Update done_today lane
$tasks.lanes.done_today = $toKeep
$tasks.version++
$tasks.updated_at = $now.ToString("o")

# Save
$tasks | ConvertTo-Json -Depth 20 | Set-Content $TasksFile -Encoding UTF8

$newSize = [math]::Round((Get-Item $TasksFile).Length / 1KB, 1)
Write-Host "`n✅ Archived $($toArchive.Count) tasks" -ForegroundColor Green
Write-Host "New tasks.json size: ${newSize}KB"
