# Infrastructure Health Check
# Run during heartbeats to catch issues early

$errors = @()
$warnings = @()

Write-Host "=== Infrastructure Health Check ===" -ForegroundColor Cyan
Write-Host "Time: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Write-Host ""

# Test 1: Mission Control Server
Write-Host "Checking Mission Control..." -NoNewline
$port = Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue
if ($port) {
    Write-Host " OK" -ForegroundColor Green
} else {
    Write-Host " FAILED" -ForegroundColor Red
    $errors += "Mission Control not running on port 8765"
}

# Test 2: state.json
Write-Host "Checking state.json..." -NoNewline
$statePath = "C:\dev\FsuelsBot\workspace\memory\state.json"
if (Test-Path $statePath) {
    try {
        $state = Get-Content $statePath -Raw | ConvertFrom-Json
        if ($state.version -and $state.currentTask) {
            Write-Host " OK (v$($state.version))" -ForegroundColor Green
        } else {
            Write-Host " INVALID" -ForegroundColor Yellow
            $warnings += "state.json missing required fields"
        }
    } catch {
        Write-Host " PARSE ERROR" -ForegroundColor Red
        $errors += "state.json is not valid JSON"
    }
} else {
    Write-Host " MISSING" -ForegroundColor Red
    $errors += "state.json does not exist"
}

# Test 3: events.jsonl
Write-Host "Checking events.jsonl..." -NoNewline
$eventsPath = "C:\dev\FsuelsBot\workspace\memory\events.jsonl"
if (Test-Path $eventsPath) {
    $lineCount = (Get-Content $eventsPath | Measure-Object -Line).Lines
    Write-Host " OK ($lineCount events)" -ForegroundColor Green
} else {
    Write-Host " MISSING" -ForegroundColor Red
    $errors += "events.jsonl does not exist"
}

# Test 4: CONSTITUTION.md
Write-Host "Checking CONSTITUTION.md..." -NoNewline
$constPath = "C:\dev\FsuelsBot\workspace\CONSTITUTION.md"
if (Test-Path $constPath) {
    Write-Host " OK" -ForegroundColor Green
} else {
    Write-Host " MISSING" -ForegroundColor Red
    $errors += "CONSTITUTION.md does not exist"
}

# Test 5: AGENTS.md has state section
Write-Host "Checking AGENTS.md state section..." -NoNewline
$agentsPath = "C:\dev\FsuelsBot\workspace\AGENTS.md"
$hasState = Select-String -Path $agentsPath -Pattern "CURRENT STATE" -Quiet
if ($hasState) {
    Write-Host " OK" -ForegroundColor Green
} else {
    Write-Host " MISSING" -ForegroundColor Yellow
    $warnings += "AGENTS.md missing CURRENT STATE section"
}

# Summary
Write-Host ""
Write-Host "=== Summary ===" -ForegroundColor Cyan
if ($errors.Count -eq 0 -and $warnings.Count -eq 0) {
    Write-Host "All checks passed!" -ForegroundColor Green
    exit 0
} else {
    if ($warnings.Count -gt 0) {
        Write-Host "Warnings: $($warnings.Count)" -ForegroundColor Yellow
        $warnings | ForEach-Object { Write-Host "  - $_" -ForegroundColor Yellow }
    }
    if ($errors.Count -gt 0) {
        Write-Host "Errors: $($errors.Count)" -ForegroundColor Red
        $errors | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
        exit 1
    }
    exit 0
}
