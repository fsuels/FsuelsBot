<#
.SYNOPSIS
    AUDIT: Checks for unverified tasks that slipped into done_today
.DESCRIPTION
    Run on heartbeat to catch any tasks that bypassed the verification gate.
    Returns list of violating tasks for immediate remediation.
#>

param([switch]$Quiet)

$WORKSPACE = "C:\dev\FsuelsBot\workspace"
$tasks = Get-Content "$WORKSPACE\memory\tasks.json" -Raw | ConvertFrom-Json

$violations = @()
$today = (Get-Date).ToString("yyyy-MM-dd")

foreach ($id in $tasks.lanes.done_today) {
    $t = $tasks.tasks.$id
    
    # Skip tasks completed before the verification system (2026-01-31)
    if ($t.completed -and $t.completed -lt "2026-01-31") { continue }
    
    # Check for violations
    $isViolation = $false
    $reason = ""
    
    if (-not $t.epistemic) {
        $isViolation = $true
        $reason = "No epistemic field"
    } elseif (-not $t.epistemic.verification_status) {
        $isViolation = $true
        $reason = "No verification_status"
    } elseif (-not $t.epistemic.claims -or $t.epistemic.claims.Count -eq 0) {
        $isViolation = $true
        $reason = "No claims[]"
    }
    
    if ($isViolation) {
        $violations += [PSCustomObject]@{
            Id = $id
            Title = $t.title
            Reason = $reason
            Completed = $t.completed
        }
    }
}

if ($violations.Count -eq 0) {
    if (-not $Quiet) { Write-Host "✅ No unverified completions since 2026-01-31" -ForegroundColor Green }
    exit 0
} else {
    Write-Host "⚠️ VIOLATIONS: $($violations.Count) tasks completed without verification!" -ForegroundColor Red
    $violations | Format-Table -AutoSize
    
    # Return count for alerting
    exit $violations.Count
}
