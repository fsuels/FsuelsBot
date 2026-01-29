# check-reconciliation.ps1
# Validates that all memory files are consistent with tasks.json (canonical source)
# Council-designed: Grade A

param(
    [switch]$Fix,
    [switch]$Verbose
)

$ErrorActionPreference = "Stop"
$WorkspaceRoot = "C:\dev\FsuelsBot\workspace"

# Canonical source
$TasksFile = Join-Path $WorkspaceRoot "memory\tasks.json"
$StateFile = Join-Path $WorkspaceRoot "memory\state.json"
$AgentsFile = Join-Path $WorkspaceRoot "AGENTS.md"

$errors = @()
$warnings = @()

Write-Host "=== Reconciliation Check ===" -ForegroundColor Cyan

# 1. Check tasks.json exists and is valid
Write-Host "`n[1] Checking canonical source (tasks.json)..." -ForegroundColor Yellow
if (-not (Test-Path $TasksFile)) {
    $errors += "CRITICAL: tasks.json does not exist!"
} else {
    try {
        $tasks = Get-Content $TasksFile -Raw | ConvertFrom-Json
        Write-Host "    OK: tasks.json is valid JSON" -ForegroundColor Green
        Write-Host "    Version: $($tasks.version)" -ForegroundColor Gray
    } catch {
        $errors += "CRITICAL: tasks.json is invalid JSON: $_"
    }
}

# 2. Check state.json derives correctly from tasks.json
Write-Host "`n[2] Checking state.json derivation..." -ForegroundColor Yellow
if (Test-Path $StateFile) {
    try {
        $state = Get-Content $StateFile -Raw | ConvertFrom-Json
        
        # Get current task from tasks.json
        $currentTaskId = $tasks.lanes.bot_current | Select-Object -First 1
        if ($currentTaskId -and $tasks.tasks.$currentTaskId) {
            $taskFromTasks = $tasks.tasks.$currentTaskId
            $taskFromState = $state.currentTask
            
            # Check if state.currentTask.id matches
            if ($taskFromState.id -ne $currentTaskId) {
                $warnings += "state.json currentTask.id ($($taskFromState.id)) doesn't match tasks.json bot_current ($currentTaskId)"
            } else {
                Write-Host "    OK: currentTask.id matches" -ForegroundColor Green
            }
            
            # Check status consistency
            if ($taskFromTasks.status -and $taskFromState.status) {
                if ($taskFromTasks.status -ne $taskFromState.status) {
                    $warnings += "state.json status ($($taskFromState.status)) differs from tasks.json ($($taskFromTasks.status))"
                }
            }
        }
        
        Write-Host "    State version: $($state.version)" -ForegroundColor Gray
    } catch {
        $errors += "state.json is invalid JSON: $_"
    }
} else {
    $warnings += "state.json does not exist"
}

# 3. Check AGENTS.md state section
Write-Host "`n[3] Checking AGENTS.md state render..." -ForegroundColor Yellow
if (Test-Path $AgentsFile) {
    $agentsContent = Get-Content $AgentsFile -Raw
    
    # Check for state section
    if ($agentsContent -match "CURRENT STATE") {
        Write-Host "    OK: State section exists" -ForegroundColor Green
        
        # Extract version from AGENTS.md
        if ($agentsContent -match "Version.*?(\d+)") {
            $agentsVersion = [int]$Matches[1]
            if ($state -and $state.version -ne $agentsVersion) {
                $warnings += "AGENTS.md version ($agentsVersion) differs from state.json ($($state.version))"
            }
        }
    } else {
        $warnings += "AGENTS.md missing state section"
    }
} else {
    $errors += "AGENTS.md does not exist"
}

# 4. Summary
Write-Host "`n=== Summary ===" -ForegroundColor Cyan

if ($errors.Count -eq 0 -and $warnings.Count -eq 0) {
    Write-Host "All checks passed! Files are consistent." -ForegroundColor Green
    exit 0
}

if ($warnings.Count -gt 0) {
    Write-Host "`nWarnings:" -ForegroundColor Yellow
    foreach ($w in $warnings) {
        Write-Host "  - $w" -ForegroundColor Yellow
    }
}

if ($errors.Count -gt 0) {
    Write-Host "`nErrors:" -ForegroundColor Red
    foreach ($e in $errors) {
        Write-Host "  - $e" -ForegroundColor Red
    }
    exit 1
}

if ($Fix) {
    Write-Host "`n[FIX] Regenerating derived files from tasks.json..." -ForegroundColor Magenta
    python "$WorkspaceRoot\scripts\regenerate-state.py"
    python "$WorkspaceRoot\scripts\render-agents-state.py"
    Write-Host "Done. Run check again to verify." -ForegroundColor Green
}

exit 0
