# check-reconciliation.ps1
# Council-designed: Grade A — Reconciliation Law enforcement
# Detects drift between canonical (tasks.json) and derived (state.json) files

param(
    [switch]$AutoFix,
    [switch]$Quiet
)

$ErrorActionPreference = "Stop"
$script:WORKSPACE = "C:\dev\FsuelsBot\workspace"
$script:LOCK_FILE = "$script:WORKSPACE\memory\.reconciliation.lock"
$script:MAX_AUTO_FIXES = 3  # Council A+: Safety rail - max auto-fixes before manual intervention

function Write-Status {
    param([string]$Message, [string]$Color = "White")
    if (-not $Quiet) { Write-Host $Message -ForegroundColor $Color }
}

# Council A+: Concurrency control via file lock
function Get-ReconciliationLock {
    $timeout = 30  # seconds
    $start = Get-Date
    
    while ((Get-Date) - $start -lt (New-TimeSpan -Seconds $timeout)) {
        if (-not (Test-Path $script:LOCK_FILE)) {
            # Create lock file with PID
            @{ pid = $PID; started = (Get-Date).ToString("o") } | ConvertTo-Json | Set-Content $script:LOCK_FILE
            return $true
        }
        
        # Check if lock is stale (>60s old)
        try {
            $lock = Get-Content $script:LOCK_FILE -Raw | ConvertFrom-Json
            $lockAge = (Get-Date) - [DateTime]::Parse($lock.started)
            if ($lockAge.TotalSeconds -gt 60) {
                Remove-Item $script:LOCK_FILE -Force
                continue
            }
        } catch {
            Remove-Item $script:LOCK_FILE -Force -ErrorAction SilentlyContinue
            continue
        }
        
        Start-Sleep -Milliseconds 100
    }
    
    return $false
}

function Release-ReconciliationLock {
    if (Test-Path $script:LOCK_FILE) {
        Remove-Item $script:LOCK_FILE -Force -ErrorAction SilentlyContinue
    }
}

# Council A+: Schema validation for tasks.json
function Test-TasksSchema {
    param($Tasks)
    
    $errors = @()
    
    # Required top-level fields
    if (-not $Tasks.lanes) { $errors += "Missing 'lanes' field" }
    if (-not $Tasks.tasks) { $errors += "Missing 'tasks' field" }
    if (-not $Tasks.version) { $errors += "Missing 'version' field" }
    
    # Validate lanes structure
    if ($Tasks.lanes) {
        $validLanes = @("bot_current", "bot_queue", "human", "scheduled", "done_today", "trash")
        foreach ($lane in $Tasks.lanes.PSObject.Properties.Name) {
            if ($lane -notin $validLanes) {
                $errors += "Unknown lane: $lane"
            }
        }
    }
    
    # Validate task references exist
    if ($Tasks.lanes -and $Tasks.tasks) {
        foreach ($lane in $Tasks.lanes.PSObject.Properties.Name) {
            foreach ($taskId in $Tasks.lanes.$lane) {
                if (-not $Tasks.tasks.$taskId) {
                    $errors += "Lane '$lane' references non-existent task: $taskId"
                }
            }
        }
    }
    
    return @{ valid = $errors.Count -eq 0; errors = $errors }
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
        const event = JSON.parse(process.argv[2]);
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
Write-Status "=== Reconciliation Check (Council A+ Enhanced) ===" "Cyan"
Write-Status "Canonical: tasks.json" "Gray"
Write-Status "Derived: state.json" "Gray"
Write-Status ""

# Council A+: Acquire lock for concurrency safety
if (-not (Get-ReconciliationLock)) {
    Write-Status "[!!] Could not acquire reconciliation lock (another process running?)" "Red"
    exit 2
}

try {
    # Council A+: Validate schema before any operations
    $tasksPath = Join-Path $script:WORKSPACE "memory/tasks.json"
    if (Test-Path $tasksPath) {
        $tasks = Get-Content $tasksPath -Raw | ConvertFrom-Json
        $schemaResult = Test-TasksSchema -Tasks $tasks
        if (-not $schemaResult.valid) {
            Write-Status "[!!] SCHEMA VALIDATION FAILED - REFUSING TO AUTO-FIX" "Red"
            foreach ($err in $schemaResult.errors) {
                Write-Status "  - $err" "Yellow"
            }
            Write-Status "Fix tasks.json manually before reconciliation can proceed" "Gray"
            exit 3
        }
        Write-Status "[OK] Schema validation passed" "Green"
    }
    
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
        # Council A+: Check auto-fix count (safety rail)
        $fixCountFile = Join-Path $script:WORKSPACE "memory/.reconciliation-fix-count"
        $today = (Get-Date).ToString("yyyy-MM-dd")
        $fixCount = 0
        
        if (Test-Path $fixCountFile) {
            $fixData = Get-Content $fixCountFile -Raw | ConvertFrom-Json
            if ($fixData.date -eq $today) {
                $fixCount = $fixData.count
            }
        }
        
        if ($fixCount -ge $script:MAX_AUTO_FIXES) {
            Write-Status "[!!] MAX AUTO-FIXES REACHED ($script:MAX_AUTO_FIXES/day) - Manual intervention required" "Red"
            Write-Status "Delete $fixCountFile to reset, or fix the root cause" "Gray"
            exit 4
        }
        
        Write-Status ""
        $fixed = Invoke-Reconciliation -Result $result
        if ($fixed) {
            # Update fix count
            @{ date = $today; count = $fixCount + 1 } | ConvertTo-Json | Set-Content $fixCountFile
            Write-Status "[OK] Reconciliation complete (fix $($fixCount + 1)/$script:MAX_AUTO_FIXES today)" "Green"
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
} finally {
    # Council A+: Always release lock
    Release-ReconciliationLock
}
