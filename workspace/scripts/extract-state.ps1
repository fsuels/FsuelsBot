<# 
.SYNOPSIS
    Extract structured state from task discussions (Council Improvement #1)
    
.DESCRIPTION
    Implements the "extracted_state" pattern from Council T045 verdict.
    Scans task discussions for decisions, constraints, and open questions.
    
.PARAMETER TaskId
    The task ID to extract state from (e.g., T045)
    
.PARAMETER DryRun
    Show what would be extracted without writing
    
.EXAMPLE
    .\extract-state.ps1 -TaskId T045
    .\extract-state.ps1 -TaskId T045 -DryRun
#>

param(
    [Parameter(Mandatory=$true)]
    [string]$TaskId,
    
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$tasksPath = "C:\dev\FsuelsBot\workspace\memory\tasks.json"

# Load tasks
$tasks = Get-Content $tasksPath -Raw | ConvertFrom-Json

if (-not $tasks.tasks.PSObject.Properties.Name.Contains($TaskId)) {
    Write-Error "Task $TaskId not found"
    exit 1
}

$task = $tasks.tasks.$TaskId

if (-not $task.discussion) {
    Write-Host "No discussion found for $TaskId"
    exit 0
}

Write-Host "`n=== Extracting state from $TaskId ===" -ForegroundColor Cyan
Write-Host "Discussion messages: $($task.discussion.Count)"

# Pattern detection
$decisions = @()
$constraints = @()
$openQuestions = @()

$decisionPatterns = @(
    "we decided",
    "the decision is",
    "approved",
    "go with",
    "let's do",
    "final answer",
    "verdict"
)

$constraintPatterns = @(
    "must always",
    "never",
    "rule:",
    "constraint:",
    "requirement:",
    "you need to",
    "i told you"
)

$questionPatterns = @(
    "?",
    "what about",
    "how should",
    "which one",
    "do you think"
)

$decisionId = 1
$constraintId = 1
$questionId = 1

foreach ($msg in $task.discussion) {
    $text = $msg.message.ToLower()
    $eventId = if ($msg.event_id) { $msg.event_id } else { $task.discussion.IndexOf($msg) + 1 }
    
    # Check for decisions
    foreach ($pattern in $decisionPatterns) {
        if ($text -match $pattern) {
            $decisions += @{
                id = "D$decisionId"
                statement = $msg.message.Substring(0, [Math]::Min(200, $msg.message.Length))
                status = "active"
                source_events = @($eventId)
                detected_pattern = $pattern
            }
            $decisionId++
            break
        }
    }
    
    # Check for constraints (only from human)
    if ($msg.author -eq "human") {
        foreach ($pattern in $constraintPatterns) {
            if ($text -match $pattern) {
                $constraints += @{
                    id = "C$constraintId"
                    text = $msg.message.Substring(0, [Math]::Min(200, $msg.message.Length))
                    status = "active"
                    source_event = $eventId
                    detected_pattern = $pattern
                }
                $constraintId++
                break
            }
        }
    }
    
    # Check for open questions (from human, not yet answered)
    if ($msg.author -eq "human" -and $text -match "\?") {
        # Simple heuristic: if ends with ?, might be open question
        $openQuestions += @{
            id = "Q$questionId"
            text = $msg.message.Substring(0, [Math]::Min(200, $msg.message.Length))
            raised_at_event = $eventId
        }
        $questionId++
    }
}

Write-Host "`n--- Detected Patterns ---" -ForegroundColor Yellow
Write-Host "Decisions found: $($decisions.Count)"
Write-Host "Constraints found: $($constraints.Count)"
Write-Host "Open questions found: $($openQuestions.Count)"

if ($decisions.Count -gt 0) {
    Write-Host "`nDecisions:" -ForegroundColor Green
    foreach ($d in $decisions) {
        Write-Host "  [$($d.id)] $($d.statement.Substring(0, [Math]::Min(80, $d.statement.Length)))..."
    }
}

if ($constraints.Count -gt 0) {
    Write-Host "`nConstraints:" -ForegroundColor Magenta
    foreach ($c in $constraints) {
        Write-Host "  [$($c.id)] $($c.text.Substring(0, [Math]::Min(80, $c.text.Length)))..."
    }
}

if ($DryRun) {
    Write-Host "`n[DRY RUN] Would write extracted_state to $TaskId" -ForegroundColor Yellow
    exit 0
}

# Build extracted_state object
$extractedState = @{
    decisions = $decisions
    constraints = $constraints
    open_questions = $openQuestions
    last_extracted = (Get-Date).ToString("o")
}

# Update task - need to reload and edit
$rawContent = Get-Content $tasksPath -Raw
$timestamp = (Get-Date).ToString("o")

# Use Python for reliable JSON manipulation
$pythonScript = @"
import json
import sys

with open(r'$tasksPath', 'r', encoding='utf-8') as f:
    data = json.load(f)

task_id = '$TaskId'
extracted = $($extractedState | ConvertTo-Json -Depth 10 -Compress)

if task_id in data['tasks']:
    data['tasks'][task_id]['extracted_state'] = json.loads('$($extractedState | ConvertTo-Json -Depth 10 -Compress)')
    data['version'] += 1
    data['updated_at'] = '$timestamp'
    data['updated_by'] = 'extract-state.ps1'
    
    with open(r'$tasksPath', 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=4, ensure_ascii=False)
    
    print(f'Successfully updated {task_id} with extracted_state')
else:
    print(f'Task {task_id} not found', file=sys.stderr)
    sys.exit(1)
"@

# For now, just report - actual update needs careful JSON handling
Write-Host "`n[INFO] Pattern detection complete. Manual review recommended before applying." -ForegroundColor Cyan
Write-Host "To apply: Review detected patterns and manually add to extracted_state field."

Write-Host "`n=== Extraction Complete ===" -ForegroundColor Cyan
