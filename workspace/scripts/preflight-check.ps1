# preflight-check.ps1
# Preflight gates for guaranteed compounding
# Verifies AGENTS.md and pack.md are fresh before autonomous ship operations
# Council recommendation: A-/B+ → A+ gap closer

param(
    [int]$MaxAgeHours = 24,  # How old can instructions be before we refuse to ship
    [switch]$Strict,         # Fail if ANY check fails
    [switch]$LogOnly         # Just log, don't fail
)

$ErrorActionPreference = "Stop"
$workspace = "C:\dev\FsuelsBot\workspace"
$eventsLog = "$workspace\memory\events.jsonl"

# Files to check
$filesToCheck = @(
    @{ Path = "$workspace\AGENTS.md"; Name = "AGENTS.md"; Required = $true },
    @{ Path = "$workspace\recall\pack.md"; Name = "pack.md"; Required = $false }
)

$results = @{
    timestamp = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ssK")
    status = "pass"
    checks = @()
    digest = @{}
    errors = @()
}

Write-Host "=== Preflight Check for Guaranteed Compounding ===" -ForegroundColor Cyan
Write-Host "Max instruction age: $MaxAgeHours hours"
Write-Host ""

foreach ($file in $filesToCheck) {
    $check = @{
        file = $file.Name
        exists = $false
        fresh = $false
        ageHours = $null
        hash = $null
    }
    
    if (Test-Path $file.Path) {
        $check.exists = $true
        $fileInfo = Get-Item $file.Path
        $age = (Get-Date) - $fileInfo.LastWriteTime
        $check.ageHours = [math]::Round($age.TotalHours, 2)
        
        # Check freshness
        if ($age.TotalHours -le $MaxAgeHours) {
            $check.fresh = $true
            Write-Host "[OK] $($file.Name): Modified $($check.ageHours)h ago" -ForegroundColor Green
        } else {
            $check.fresh = $false
            Write-Host "[STALE] $($file.Name): Modified $($check.ageHours)h ago (limit: $MaxAgeHours h)" -ForegroundColor Yellow
            if ($file.Required -and -not $LogOnly) {
                $results.status = "fail"
                $results.errors += "$($file.Name) is stale ($($check.ageHours)h > $MaxAgeHours h)"
            }
        }
        
        # Calculate hash for audit trail
        $hash = Get-FileHash -Path $file.Path -Algorithm SHA256
        $check.hash = $hash.Hash.Substring(0, 16)  # First 16 chars for brevity
        $results.digest[$file.Name] = $check.hash
        
    } else {
        Write-Host "[MISSING] $($file.Name): File not found" -ForegroundColor Red
        if ($file.Required) {
            $results.status = "fail"
            $results.errors += "$($file.Name) not found"
        }
    }
    
    $results.checks += $check
}

# Log to events.jsonl
$eventId = "EVT-" + (Get-Date).ToString("yyyyMMdd") + "-" + (Get-Random -Minimum 100 -Maximum 999)
$event = @{
    ts = $results.timestamp
    id = $eventId
    type = "preflight_check"
    priority = "P3"
    content = "Preflight check: $($results.status). AGENTS.md=$(if($results.digest['AGENTS.md']){$results.digest['AGENTS.md']}else{'missing'}), pack.md=$(if($results.digest['pack.md']){$results.digest['pack.md']}else{'missing'})"
    tags = @("preflight", "compound-engineering", "ship")
    session = "cron:ship"
    digest = $results.digest
    status = $results.status
} | ConvertTo-Json -Compress

Add-Content -Path $eventsLog -Value $event
Write-Host ""
Write-Host "Logged to events.jsonl: $eventId" -ForegroundColor Gray

# Summary
Write-Host ""
Write-Host "=== Preflight Result ===" -ForegroundColor Cyan
if ($results.status -eq "pass") {
    Write-Host "STATUS: PASS - Safe to ship" -ForegroundColor Green
    Write-Host "Instruction digest logged for audit trail"
    exit 0
} else {
    Write-Host "STATUS: FAIL - Do NOT ship" -ForegroundColor Red
    foreach ($err in $results.errors) {
        Write-Host "  - $err" -ForegroundColor Red
    }
    Write-Host ""
    Write-Host "Run consolidation or manually update AGENTS.md before shipping."
    if (-not $LogOnly) {
        exit 1
    }
    exit 0
}
