<# 
.SYNOPSIS
    Calculate verification rate for completed tasks
.DESCRIPTION
    Reads tasks.json and calculates:
    - Total completed tasks (done_today)
    - Verified tasks (epistemic.verification_status != 'claimed')
    - Verification rate percentage
#>

param(
    [switch]$Quiet,
    [switch]$Json
)

$tasksPath = "C:\dev\FsuelsBot\workspace\memory\tasks.json"
$tasks = Get-Content $tasksPath | ConvertFrom-Json

$doneTasks = $tasks.lanes.done_today
$total = $doneTasks.Count
$verified = 0
$humanVerified = 0
$evidenceProvided = 0
$autoVerified = 0
$claimed = 0

foreach ($taskId in $doneTasks) {
    $task = $tasks.tasks.$taskId
    if ($task -and $task.epistemic -and $task.epistemic.verification_status) {
        switch ($task.epistemic.verification_status) {
            'human_verified' { $humanVerified++; $verified++ }
            'evidence_provided' { $evidenceProvided++; $verified++ }
            'automated_verified' { $autoVerified++; $verified++ }
            'claimed' { $claimed++ }
        }
    } else {
        # No epistemic data = claimed
        $claimed++
    }
}

$rate = if ($total -gt 0) { [math]::Round(($verified / $total) * 100, 1) } else { 0 }

if ($Json) {
    @{
        total = $total
        verified = $verified
        claimed = $claimed
        human_verified = $humanVerified
        evidence_provided = $evidenceProvided
        automated_verified = $autoVerified
        rate = $rate
    } | ConvertTo-Json
} elseif (-not $Quiet) {
    Write-Host "=== Verification Rate ===" -ForegroundColor Cyan
    Write-Host "Total completed: $total"
    Write-Host "Verified: $verified ($rate%)"
    Write-Host "  - Human verified: $humanVerified"
    Write-Host "  - Evidence provided: $evidenceProvided"
    Write-Host "  - Auto verified: $autoVerified"
    Write-Host "Claimed (unverified): $claimed"
    
    if ($rate -ge 80) {
        Write-Host "`nStatus: EXCELLENT" -ForegroundColor Green
    } elseif ($rate -ge 50) {
        Write-Host "`nStatus: NEEDS IMPROVEMENT" -ForegroundColor Yellow
    } else {
        Write-Host "`nStatus: POOR - Most completions unverified" -ForegroundColor Red
    }
} else {
    Write-Output $rate
}
