# cron-idempotency.ps1
# Council-designed: Grade A+ — Idempotent cron runs with full auditability
# Usage: . .\scripts\cron-idempotency.ps1; $run = Start-CronRun "job-name"; ... Complete-CronRun $run

$script:CRON_RUNS_DIR = "memory/cron-runs"
$script:STALE_THRESHOLD_HOURS = 1
$script:TIMEZONE = "America/New_York"

function Get-ESTDate {
    param([DateTime]$Date = (Get-Date))
    $tz = [TimeZoneInfo]::FindSystemTimeZoneById("Eastern Standard Time")
    $estTime = [TimeZoneInfo]::ConvertTime($Date, $tz)
    return $estTime.ToString("yyyy-MM-dd")
}

function Get-ESTHour {
    param([DateTime]$Date = (Get-Date))
    $tz = [TimeZoneInfo]::FindSystemTimeZoneById("Eastern Standard Time")
    $estTime = [TimeZoneInfo]::ConvertTime($Date, $tz)
    return $estTime.ToString("HH")
}

function Get-IdempotencyWindow {
    param(
        [Parameter(Mandatory)][string]$Window  # hourly, daily, weekly, none
    )
    $date = Get-ESTDate
    switch ($Window) {
        "hourly" { return "$date`T$(Get-ESTHour)" }
        "daily" { return $date }
        "weekly" { 
            $now = Get-Date
            $weekStart = $now.AddDays(-[int]$now.DayOfWeek)
            return Get-ESTDate -Date $weekStart
        }
        "none" { return [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds().ToString() }
    }
}

function Get-CronRunsFilePath {
    $date = Get-ESTDate
    return Join-Path $script:CRON_RUNS_DIR "$date.jsonl"
}

function Read-CronRuns {
    param([string]$FilePath = (Get-CronRunsFilePath))
    
    if (-not (Test-Path $FilePath)) { return @() }
    
    $runs = @()
    Get-Content -Path $FilePath -Encoding UTF8 | ForEach-Object {
        if ($_.Trim()) {
            try {
                $obj = $_ | ConvertFrom-Json
                # Convert PSCustomObject to hashtable
                $ht = @{}
                $obj.PSObject.Properties | ForEach-Object { $ht[$_.Name] = $_.Value }
                $runs += $ht
            } catch {}
        }
    }
    return $runs
}

function Append-CronRun {
    param([Parameter(Mandatory)][hashtable]$Run)
    
    if (-not (Test-Path $script:CRON_RUNS_DIR)) {
        New-Item -Path $script:CRON_RUNS_DIR -ItemType Directory -Force | Out-Null
    }
    
    $filePath = Get-CronRunsFilePath
    $json = $Run | ConvertTo-Json -Compress
    Add-Content -Path $filePath -Value $json -Encoding UTF8
}

function Test-ShouldRun {
    <#
    .SYNOPSIS
    Check if a cron job should run based on idempotency rules.
    .OUTPUTS
    Hashtable with: ShouldRun (bool), Reason (string), ExistingRun (hashtable or $null)
    #>
    param(
        [Parameter(Mandatory)][string]$JobId,
        [string]$Window = "daily",
        [string]$Trigger = "scheduled",
        [switch]$Force
    )
    
    $idempotencyWindow = Get-IdempotencyWindow -Window $Window
    $runs = Read-CronRuns
    
    # Find existing run for this job + window
    $existing = $runs | Where-Object { 
        $_.job -eq $JobId -and 
        $_.window -eq $idempotencyWindow -and 
        ($_.status -eq "completed" -or $_.status -eq "started")
    } | Select-Object -First 1
    
    # Force override
    if ($Force) {
        return @{ ShouldRun = $true; Reason = "force-override"; ExistingRun = $existing }
    }
    
    # No previous run
    if (-not $existing) {
        return @{ ShouldRun = $true; Reason = "no-previous-run"; ExistingRun = $null }
    }
    
    # Already in progress - check if stale
    if ($existing.status -eq "started") {
        $startedAt = [DateTime]::Parse($existing.started_at)
        $staleThreshold = (Get-Date).AddHours(-$script:STALE_THRESHOLD_HOURS)
        if ($startedAt -lt $staleThreshold) {
            return @{ ShouldRun = $true; Reason = "stale-run-recovery"; ExistingRun = $existing }
        }
        return @{ ShouldRun = $false; Reason = "already-in-progress"; ExistingRun = $existing }
    }
    
    # Already completed
    if ($existing.status -eq "completed") {
        return @{ ShouldRun = $false; Reason = "already-completed"; ExistingRun = $existing }
    }
    
    # Failed runs don't block
    return @{ ShouldRun = $true; Reason = "previous-failed"; ExistingRun = $existing }
}

function Start-CronRun {
    <#
    .SYNOPSIS
    Start a cron run with idempotency check. Returns run object or $null if should skip.
    #>
    param(
        [Parameter(Mandatory)][string]$JobId,
        [string]$Window = "daily",
        [string]$Trigger = "scheduled",
        [switch]$Force
    )
    
    $check = Test-ShouldRun -JobId $JobId -Window $Window -Trigger $Trigger -Force:$Force
    
    if (-not $check.ShouldRun) {
        # Log skip
        $now = Get-Date
        $skip = @{
            id = "cron-$($now.ToString('yyyyMMdd-HHmmss'))-$JobId-SKIP"
            job = $JobId
            window = Get-IdempotencyWindow -Window $Window
            started_at = $now.ToString("o")
            completed_at = $now.ToString("o")
            status = "skipped"
            result = $null
            reason = $check.Reason
            previous_run_id = if ($check.ExistingRun) { $check.ExistingRun.id } else { $null }
            trigger = $Trigger
            force = $false
        }
        Append-CronRun -Run $skip
        Write-Host "[$JobId] Skipped: $($check.Reason)" -ForegroundColor Yellow
        return $null
    }
    
    # Start the run
    $now = Get-Date
    $run = @{
        id = "cron-$($now.ToString('yyyyMMdd-HHmmss'))-$JobId"
        job = $JobId
        window = Get-IdempotencyWindow -Window $Window
        started_at = $now.ToString("o")
        completed_at = $null
        status = "started"
        result = $null
        trigger = $Trigger
        force = [bool]$Force
    }
    Append-CronRun -Run $run
    Write-Host "[$JobId] Started (reason: $($check.Reason))" -ForegroundColor Green
    return $run
}

function Complete-CronRun {
    <#
    .SYNOPSIS
    Mark a cron run as completed or failed.
    #>
    param(
        [Parameter(Mandatory)][hashtable]$Run,
        [string]$Status = "completed",
        [string]$Result = ""
    )
    
    $filePath = Get-CronRunsFilePath
    $runs = Read-CronRuns -FilePath $filePath
    
    # Update the matching run
    $lines = @()
    foreach ($r in $runs) {
        if ($r.id -eq $Run.id) {
            $r.completed_at = (Get-Date).ToString("o")
            $r.status = $Status
            $r.result = $Result
        }
        $lines += ($r | ConvertTo-Json -Compress)
    }
    
    # Rewrite file atomically
    $tempPath = "$filePath.tmp"
    $lines | Set-Content -Path $tempPath -Encoding UTF8
    Move-Item -Path $tempPath -Destination $filePath -Force
    
    $color = if ($Status -eq "completed") { "Green" } else { "Red" }
    Write-Host "[$($Run.job)] ${Status}: $Result" -ForegroundColor $color
}

function Get-CronStatus {
    <#
    .SYNOPSIS
    Show status of today's cron runs.
    #>
    param([string]$JobId)
    
    $runs = Read-CronRuns
    if ($JobId) {
        $runs = $runs | Where-Object { $_.job -eq $JobId }
    }
    
    foreach ($r in $runs) {
        $emoji = switch ($r.status) {
            "completed" { "[OK]" }
            "started" { "[..]" }
            "failed" { "[!!]" }
            "skipped" { "[--]" }
            default { "[??]" }
        }
        $color = switch ($r.status) {
            "completed" { "Green" }
            "started" { "Cyan" }
            "failed" { "Red" }
            "skipped" { "Yellow" }
            default { "White" }
        }
        Write-Host "$emoji $($r.job) | $($r.status) | $($r.started_at)" -ForegroundColor $color
    }
}

function Clear-OldCronRuns {
    <#
    .SYNOPSIS
    Remove run files older than specified days.
    #>
    param([int]$DaysToKeep = 30)
    
    if (-not (Test-Path $script:CRON_RUNS_DIR)) { return 0 }
    
    $cutoff = (Get-Date).AddDays(-$DaysToKeep)
    $deleted = 0
    
    Get-ChildItem -Path $script:CRON_RUNS_DIR -Filter *.jsonl | ForEach-Object {
        $dateStr = $_.BaseName
        try {
            $fileDate = [DateTime]::ParseExact($dateStr, "yyyy-MM-dd", $null)
            if ($fileDate -lt $cutoff) {
                Remove-Item $_.FullName -Force
                $deleted++
            }
        } catch {}
    }
    
    Write-Host "Cleaned up $deleted old cron run files"
    return $deleted
}

# Functions available after dot-sourcing:
# Test-ShouldRun, Start-CronRun, Complete-CronRun, Get-CronStatus, Clear-OldCronRuns
