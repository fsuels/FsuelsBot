# check-reconciliation.ps1
# Council-designed: Grade A — Reconciliation Law enforcement
# Detects drift between canonical (tasks.json) and derived (state.json) files

param(
    [switch]$AutoFix,
    [switch]$Quiet
)

$ErrorActionPreference = "Stop"
$script:WORKSPACE = "C:\dev\FsuelsBot\workspace"

function Write-Status {
    param([string]$Message, [string]$Color = "White")
    if (-not $Quiet) { Write-Host $Message -ForegroundColor $Color }
}

function Get-CanonicalState {
    # Extract current state from tasks.json (THE CANONICAL SOURCE)
    $tasksPath = Join-Path $script:WORKSPACE "memory/tasks.json"
    if (-not (Test-Path $tasksPath)) {
        throw "Canonical file not found: $tasksPath"
    }
    
    $tasks = Get-Content $tasksPath -Raw | ConvertFrom-Json
    $currentTaskId = $tasks.lanes.bot_current | Select-Object -First 1
    
    if (-not $currentTaskId) {
        return @{
            taskId = $null
            status = "idle"
            currentStep = $null
            title = "No active task"
        }
    }
    
    $task = $tasks.tasks.$currentTaskId
    $currentStepIndex = if ($task.current_step -ne $null) { $task.current_step } else { 0 }
    $currentStep = if ($task.steps -and $task.steps.Count -gt $currentStepIndex) {
        $task.steps[$currentStepIndex].step
    } else { $null }
    
    return @{
        taskId = $currentTaskId
        status = $task.status
        currentStep = $currentStep
        title = $task.title
        version = $tasks.version
    }
}

function Get-DerivedState {
    # Extract current state from state.json (DERIVED)
    $statePath = Join-Path $script:WORKSPACE "memory/state.json"
    if (-not (Test-Path $statePath)) {
        return $null
    }
    
    $state = Get-Content $statePath -Raw | ConvertFrom-Json
    return @{
        taskId = $state.currentTask.id
        status = $state.currentTask.status
        currentStep = $state.currentTask.currentStep
        title = $state.currentTask.description
        version = $state.version
    }
}

function Test-Reconciliation {
    $canonical = Get-CanonicalState
    $derived = Get-DerivedState
    
    $drift = @()
    
    if (-not $derived) {
        $drift += @{
            field = "state.json"
            canonical = "exists"
            derived = "MISSING"
            severity = "HIGH"
        }
        return @{ hasDrift = $true; drift = $drift; canonical = $canonical; derived = $null }
    }
    
    # Check task ID
    if ($canonical.taskId -ne $derived.taskId) {
        $drift += @{
            field = "currentTask.id"
            canonical = $canonical.taskId
            derived = $derived.taskId
            severity = "HIGH"
        }
    }
    
    # Check status
    if ($canonical.status -ne $derived.status) {
        $drift += @{
            field = "currentTask.status"
            canonical = $canonical.status
            derived = $derived.status
            severity = "MEDIUM"
        }
    }
    
    # Check title (description)
    if ($canonical.title -ne $derived.title) {
        $drift += @{
            field = "currentTask.title"
            canonical = $canonical.title
            derived = $derived.title
            severity = "LOW"
        }
    }
    
    return @{
        hasDrift = $drift.Count -gt 0
        drift = $drift
        canonical = $canonical
        derived = $derived
    }
}

function Invoke-Reconciliation {
    param($Result)
    
    Write-Status "Regenerating state.json from tasks.json..." "Yellow"
    
    $canonical = $Result.canonical
    $statePath = Join-Path $script:WORKSPACE "memory/state.json"
    
    # Read existing state.json for fields we don't derive
    $existingState = if (Test-Path $statePath) {
        Get-Content $statePath -Raw | ConvertFrom-Json
    } else { $null }
    
    # Build new state from canonical
    $newState = @{
        lastUpdated = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ss-05:00")
        version = if ($existingState) { $existingState.version + 1 } else { 1 }
        currentTask = @{
            id = $canonical.taskId
            description = $canonical.title
            status = $canonical.status
            currentStep = $canonical.currentStep
            context = ""
            nextStep = $null
        }
        deadline = if ($existingState.deadline) { $existingState.deadline } else { @{} }
        taskBoard = "memory/tasks.json"
        standingRules = if ($existingState.standingRules) { $existingState.standingRules } else { @() }
    }
    
    # Write atomically
    $tempPath = "$statePath.tmp"
    $newState | ConvertTo-Json -Depth 10 | Set-Content $tempPath -Encoding UTF8
    Move-Item $tempPath $statePath -Force
    
    Write-Status "state.json regenerated (version $($newState.version))" "Green"
    
    # Log reconciliation event WITH HASH CHAIN
    $eventPath = Join-Path $script:WORKSPACE "memory/events.jsonl"
    $driftList = ($Result.drift | ForEach-Object { "$($_.field): $($_.derived) -> $($_.canonical)" }) -join "; "
    $event = @{
        ts = (Get-Date).ToUniversalTime().ToString("o")
        id = "EVT-$(Get-Date -Format 'yyyyMMdd')-REC"
        type = "reconciliation"
        priority = "P2"
        content = "Auto-reconciliation: regenerated state.json from tasks.json"
        drift = $driftList
        session = "reconciliation"
    }
    
    # Use hash-chain.cjs to append with proper hashing
    $eventJson = $event | ConvertTo-Json -Compress
    $appendResult = node -e "
        const hc = require('./scripts/hash-chain.cjs');
        const event = JSON.parse(process.argv[1]);
        try {
            hc.appendEvent('$eventPath'.replace(/\\/g, '/'), event);
            console.log('OK');
        } catch (e) {
            console.error(e.message);
            process.exit(1);
        }
    " $eventJson 2>&1
    
    if ($LASTEXITCODE -ne 0) {
        Write-Status "[WARN] Hash-chain append failed, using direct append" "Yellow"
        $event | ConvertTo-Json -Compress | Add-Content $eventPath -Encoding UTF8
    }
    
    return $true
}

# Main execution
Write-Status "=== Reconciliation Check ===" "Cyan"
Write-Status "Canonical: tasks.json" "Gray"
Write-Status "Derived: state.json" "Gray"
Write-Status ""

$result = Test-Reconciliation

if (-not $result.hasDrift) {
    Write-Status "[OK] No drift detected" "Green"
    exit 0
}

Write-Status "[!!] DRIFT DETECTED:" "Red"
foreach ($d in $result.drift) {
    Write-Status "  - $($d.field): tasks.json='$($d.canonical)' vs state.json='$($d.derived)' [$($d.severity)]" "Yellow"
}

if ($AutoFix) {
    Write-Status ""
    $fixed = Invoke-Reconciliation -Result $result
    if ($fixed) {
        Write-Status "[OK] Reconciliation complete" "Green"
        exit 0
    } else {
        Write-Status "[!!] Reconciliation failed" "Red"
        exit 1
    }
} else {
    Write-Status ""
    Write-Status "Run with -AutoFix to regenerate derived files" "Gray"
    exit 1
}
