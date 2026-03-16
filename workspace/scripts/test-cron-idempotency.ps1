# Test script for cron idempotency
. "$PSScriptRoot\cron-idempotency.ps1"

Write-Host "=== Test 1: First run (should start) ===" -ForegroundColor Cyan
$run1 = Start-CronRun -JobId "test-job"
if ($run1) {
    Complete-CronRun -Run $run1 -Status "completed" -Result "first run success"
} else {
    Write-Host "ERROR: First run should not be skipped!" -ForegroundColor Red
}

Write-Host "`n=== Test 2: Duplicate run (should skip) ===" -ForegroundColor Cyan
$run2 = Start-CronRun -JobId "test-job"
if ($run2) {
    Write-Host "ERROR: Duplicate run should be skipped!" -ForegroundColor Red
    Complete-CronRun -Run $run2 -Status "completed" -Result "should not happen"
} else {
    Write-Host "PASS: Duplicate correctly skipped" -ForegroundColor Green
}

Write-Host "`n=== Test 3: Force override (should start) ===" -ForegroundColor Cyan
$run3 = Start-CronRun -JobId "test-job" -Force
if ($run3) {
    Complete-CronRun -Run $run3 -Status "completed" -Result "force override success"
    Write-Host "PASS: Force override works" -ForegroundColor Green
} else {
    Write-Host "ERROR: Force should not be skipped!" -ForegroundColor Red
}

Write-Host "`n=== Today's Cron Status ===" -ForegroundColor Cyan
Get-CronStatus
