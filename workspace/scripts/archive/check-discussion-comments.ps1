# check-discussion-comments.ps1
# Checks for unanswered human comments in task discussions
# Returns JSON of tasks needing bot response

param(
    [switch]$Quiet
)

$tasksFile = "C:\dev\FsuelsBot\workspace\memory\tasks.json"
$pendingFile = "C:\dev\FsuelsBot\workspace\memory\pending-discussion-replies.json"

try {
    $tasks = Get-Content $tasksFile -Raw | ConvertFrom-Json
    
    $needsReply = @()
    
    # Check all tasks in bot_current and human lanes
    $lanesToCheck = @()
    if ($tasks.lanes.bot_current) { $lanesToCheck += $tasks.lanes.bot_current }
    if ($tasks.lanes.human) { $lanesToCheck += $tasks.lanes.human }
    
    foreach ($taskId in $lanesToCheck) {
        $task = $tasks.tasks.$taskId
        if (-not $task) { continue }
        
        $discussion = $task.discussion
        if (-not $discussion -or $discussion.Count -eq 0) { continue }
        
        # Get the last comment
        $lastComment = $discussion[$discussion.Count - 1]
        
        # If last comment is from human, bot needs to respond
        if ($lastComment.author -eq "human") {
            $needsReply += @{
                taskId = $taskId
                taskTitle = $task.title
                lastComment = $lastComment.message
                timestamp = $lastComment.ts
                commentIndex = $discussion.Count - 1
            }
        }
    }
    
    if ($needsReply.Count -gt 0) {
        # Write pending replies file for bot to process
        $needsReply | ConvertTo-Json -Depth 10 | Set-Content $pendingFile -Encoding UTF8
        
        if (-not $Quiet) {
            Write-Host "Found $($needsReply.Count) task(s) needing reply:"
            foreach ($item in $needsReply) {
                Write-Host "  [$($item.taskId)] $($item.lastComment.Substring(0, [Math]::Min(50, $item.lastComment.Length)))..."
            }
        }
        
        # Return the data
        $needsReply | ConvertTo-Json -Depth 10
    } else {
        if (-not $Quiet) {
            Write-Host "No pending discussion replies needed."
        }
        # Clean up pending file if exists
        if (Test-Path $pendingFile) {
            Remove-Item $pendingFile -Force
        }
        "[]"
    }
} catch {
    Write-Error "Error checking discussions: $_"
    exit 1
}
