# Memory Integrity Validator
# Run this to verify memory system health

$workspace = "C:\dev\FsuelsBot\workspace"
$errors = @()
$warnings = @()

Write-Host "=== Memory Integrity Check ===" -ForegroundColor Cyan
Write-Host ""

# Check 1: state.json exists and is valid JSON
Write-Host "Checking state.json..." -NoNewline
$stateFile = "$workspace\memory\state.json"
if (Test-Path $stateFile) {
    try {
        $state = Get-Content $stateFile -Raw | ConvertFrom-Json
        if ($state.version -and $state.currentTask) {
            Write-Host " OK" -ForegroundColor Green
        } else {
            Write-Host " INCOMPLETE" -ForegroundColor Yellow
            $warnings += "state.json missing required fields"
        }
    } catch {
        Write-Host " INVALID JSON" -ForegroundColor Red
        $errors += "state.json is not valid JSON"
    }
} else {
    Write-Host " MISSING" -ForegroundColor Red
    $errors += "state.json does not exist"
}

# Check 2: events.jsonl exists
Write-Host "Checking events.jsonl..." -NoNewline
$eventsFile = "$workspace\memory\events.jsonl"
if (Test-Path $eventsFile) {
    $lineCount = (Get-Content $eventsFile | Measure-Object -Line).Lines
    Write-Host " OK ($lineCount events)" -ForegroundColor Green
} else {
    Write-Host " MISSING" -ForegroundColor Yellow
    $warnings += "events.jsonl does not exist (will be created on first event)"
}

# Check 3: active-thread.md exists
Write-Host "Checking active-thread.md..." -NoNewline
$threadFile = "$workspace\memory\active-thread.md"
if (Test-Path $threadFile) {
    Write-Host " OK" -ForegroundColor Green
} else {
    Write-Host " MISSING" -ForegroundColor Red
    $errors += "active-thread.md does not exist"
}

# Check 4: CONSTITUTION.md exists
Write-Host "Checking CONSTITUTION.md..." -NoNewline
$constFile = "$workspace\CONSTITUTION.md"
if (Test-Path $constFile) {
    Write-Host " OK" -ForegroundColor Green
} else {
    Write-Host " MISSING" -ForegroundColor Red
    $errors += "CONSTITUTION.md does not exist"
}

# Check 5: AGENTS.md has CURRENT STATE section
Write-Host "Checking AGENTS.md state render..." -NoNewline
$agentsFile = "$workspace\AGENTS.md"
if (Test-Path $agentsFile) {
    $content = Get-Content $agentsFile -Raw
    if ($content -match "CURRENT STATE") {
        Write-Host " OK" -ForegroundColor Green
    } else {
        Write-Host " NO STATE SECTION" -ForegroundColor Red
        $errors += "AGENTS.md missing CURRENT STATE section"
    }
} else {
    Write-Host " MISSING" -ForegroundColor Red
    $errors += "AGENTS.md does not exist"
}

# Check 6: Mission Control running
Write-Host "Checking Mission Control..." -NoNewline
$tcpTest = Test-NetConnection -ComputerName localhost -Port 8765 -InformationLevel Quiet -WarningAction SilentlyContinue
if ($tcpTest) {
    Write-Host " RUNNING" -ForegroundColor Green
} else {
    Write-Host " NOT RUNNING" -ForegroundColor Red
    $errors += "Mission Control not running on port 8765"
}

# Check 7: Today's memory file exists
Write-Host "Checking today's memory file..." -NoNewline
$today = Get-Date -Format "yyyy-MM-dd"
$todayFile = "$workspace\memory\$today.md"
if (Test-Path $todayFile) {
    Write-Host " OK" -ForegroundColor Green
} else {
    Write-Host " MISSING (will be created)" -ForegroundColor Yellow
    $warnings += "No memory file for today yet"
}

# Check 8: Reconciliation (tasks.json vs state.json)
Write-Host "Checking reconciliation..." -NoNewline
$reconcileScript = "$workspace\scripts\check-reconciliation.ps1"
if (Test-Path $reconcileScript) {
    $result = & powershell -ExecutionPolicy Bypass -File $reconcileScript -Quiet 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host " OK" -ForegroundColor Green
    } else {
        Write-Host " DRIFT DETECTED" -ForegroundColor Yellow
        $warnings += "Reconciliation drift detected - run check-reconciliation.ps1 -AutoFix"
    }
} else {
    Write-Host " SCRIPT MISSING" -ForegroundColor Yellow
    $warnings += "check-reconciliation.ps1 not found"
}

# Summary
Write-Host ""
Write-Host "=== Summary ===" -ForegroundColor Cyan

if ($errors.Count -eq 0) {
    Write-Host "All critical checks passed!" -ForegroundColor Green
} else {
    Write-Host "ERRORS:" -ForegroundColor Red
    foreach ($err in $errors) {
        Write-Host "  - $err" -ForegroundColor Red
    }
}

if ($warnings.Count -gt 0) {
    Write-Host "WARNINGS:" -ForegroundColor Yellow
    foreach ($warn in $warnings) {
        Write-Host "  - $warn" -ForegroundColor Yellow
    }
}

# Return exit code
if ($errors.Count -gt 0) { exit 1 } else { exit 0 }
