# circuit-breaker.ps1
# Council-designed: Grade A — API failure tracking with graceful degradation
# Usage: . .\scripts\circuit-breaker.ps1; Test-Circuit "gemini"; Record-Success "gemini"

$script:CIRCUITS_FILE = "memory/circuits.json"

function Get-Circuits {
    if (-not (Test-Path $script:CIRCUITS_FILE)) {
        return $null
    }
    Get-Content $script:CIRCUITS_FILE -Raw | ConvertFrom-Json
}

function Save-Circuits {
    param([Parameter(Mandatory)]$Circuits)
    $Circuits.updated_at = (Get-Date).ToString("o")
    $tempPath = "$script:CIRCUITS_FILE.tmp"
    $Circuits | ConvertTo-Json -Depth 10 | Set-Content $tempPath -Encoding UTF8
    Move-Item $tempPath $script:CIRCUITS_FILE -Force
}

function Test-Circuit {
    <#
    .SYNOPSIS
    Check if a request should proceed for given API.
    .OUTPUTS
    Hashtable: { Allowed, Reason, RetryAfter, IsProbe }
    #>
    param([Parameter(Mandatory)][string]$Api)
    
    $circuits = Get-Circuits
    if (-not $circuits) {
        return @{ Allowed = $true; Reason = "no_circuit_file" }
    }
    
    $circuit = $circuits.circuits.$Api
    if (-not $circuit) {
        return @{ Allowed = $true; Reason = "unknown_api" }
    }
    
    $settings = $circuits.settings
    $now = Get-Date
    
    switch ($circuit.state) {
        "closed" {
            return @{ Allowed = $true; Reason = "circuit_closed" }
        }
        "open" {
            if ($circuit.opened_at) {
                $openedAt = [DateTime]::Parse($circuit.opened_at)
                $elapsed = ($now - $openedAt).TotalMilliseconds
                if ($elapsed -ge $settings.open_duration_ms) {
                    # Transition to half-open
                    $circuit.state = "half_open"
                    $circuit.half_open_at = $now.ToString("o")
                    Save-Circuits -Circuits $circuits
                    return @{ Allowed = $true; Reason = "half_open_probe"; IsProbe = $true }
                }
            }
            $retryAfter = if ($circuit.opened_at) {
                [DateTime]::Parse($circuit.opened_at).AddMilliseconds($settings.open_duration_ms)
            } else { $now.AddMinutes(5) }
            return @{ Allowed = $false; Reason = "circuit_open"; RetryAfter = $retryAfter }
        }
        "half_open" {
            if ($circuit.half_open_at) {
                $halfOpenAt = [DateTime]::Parse($circuit.half_open_at)
                $elapsed = ($now - $halfOpenAt).TotalMilliseconds
                if ($elapsed -ge $settings.half_open_timeout_ms) {
                    return @{ Allowed = $true; Reason = "half_open_retry"; IsProbe = $true }
                }
            }
            return @{ Allowed = $false; Reason = "half_open_probe_in_progress" }
        }
    }
    return @{ Allowed = $true; Reason = "default" }
}

function Record-Success {
    <#
    .SYNOPSIS
    Record a successful API call. May close circuit if in half-open state.
    #>
    param([Parameter(Mandatory)][string]$Api)
    
    $circuits = Get-Circuits
    if (-not $circuits) { return }
    
    $circuit = $circuits.circuits.$Api
    if (-not $circuit) { return }
    
    $settings = $circuits.settings
    $now = (Get-Date).ToString("o")
    
    $circuit.success_count++
    $circuit.last_success = $now
    
    if ($circuit.state -eq "half_open") {
        if ($circuit.success_count -ge $settings.success_threshold) {
            # Close the circuit
            $circuit.state = "closed"
            $circuit.failure_count = 0
            $circuit.opened_at = $null
            $circuit.half_open_at = $null
            $circuit.error_types = @{}
            Write-Host "[$Api] Circuit CLOSED (recovered)" -ForegroundColor Green
        }
    } elseif ($circuit.state -eq "closed") {
        $circuit.failure_count = 0
    }
    
    Save-Circuits -Circuits $circuits
}

function Record-Failure {
    <#
    .SYNOPSIS
    Record a failed API call. May open circuit if threshold reached.
    #>
    param(
        [Parameter(Mandatory)][string]$Api,
        [string]$ErrorType = "unknown"
    )
    
    $circuits = Get-Circuits
    if (-not $circuits) { return }
    
    $circuit = $circuits.circuits.$Api
    if (-not $circuit) { return }
    
    $settings = $circuits.settings
    $now = (Get-Date).ToString("o")
    
    $circuit.failure_count++
    $circuit.success_count = 0
    $circuit.last_failure = $now
    
    # Track error type (skip if PSCustomObject doesn't support dynamic properties)
    try {
        if ($circuit.error_types -is [hashtable]) {
            if (-not $circuit.error_types.ContainsKey($ErrorType)) {
                $circuit.error_types[$ErrorType] = 0
            }
            $circuit.error_types[$ErrorType]++
        }
    } catch {
        # Ignore error type tracking errors - not critical
    }
    
    if ($circuit.state -eq "half_open") {
        # Immediately re-open
        $circuit.state = "open"
        $circuit.opened_at = $now
        $circuit.half_open_at = $null
        Write-Host "[$Api] Circuit RE-OPENED (probe failed: $ErrorType)" -ForegroundColor Red
    } elseif ($circuit.state -eq "closed") {
        if ($circuit.failure_count -ge $settings.failure_threshold) {
            # Open the circuit
            $circuit.state = "open"
            $circuit.opened_at = $now
            Write-Host "[$Api] Circuit OPENED ($($circuit.failure_count) failures: $ErrorType)" -ForegroundColor Red
        } else {
            Write-Host "[$Api] Failure recorded ($($circuit.failure_count)/$($settings.failure_threshold)): $ErrorType" -ForegroundColor Yellow
        }
    }
    
    Save-Circuits -Circuits $circuits
}

function Reset-Circuit {
    <#
    .SYNOPSIS
    Force reset a circuit to closed state.
    #>
    param([Parameter(Mandatory)][string]$Api)
    
    $circuits = Get-Circuits
    if (-not $circuits) { return }
    
    $circuits.circuits.$Api = @{
        state = "closed"
        failure_count = 0
        success_count = 0
        last_failure = $null
        last_success = $null
        opened_at = $null
        half_open_at = $null
        error_types = @{}
    }
    
    Save-Circuits -Circuits $circuits
    Write-Host "[$Api] Circuit RESET" -ForegroundColor Cyan
}

function Get-CircuitStatus {
    <#
    .SYNOPSIS
    Display status of all circuits.
    #>
    $circuits = Get-Circuits
    if (-not $circuits) {
        Write-Host "No circuits file found" -ForegroundColor Yellow
        return
    }
    
    Write-Host "=== Circuit Breaker Status ===" -ForegroundColor Cyan
    Write-Host ""
    
    foreach ($api in $circuits.circuits.PSObject.Properties.Name) {
        $c = $circuits.circuits.$api
        $stateColor = switch ($c.state) {
            "closed" { "Green" }
            "open" { "Red" }
            "half_open" { "Yellow" }
            default { "White" }
        }
        $stateIcon = switch ($c.state) {
            "closed" { "[OK]" }
            "open" { "[!!]" }
            "half_open" { "[??]" }
            default { "[--]" }
        }
        
        Write-Host "$stateIcon $($api.ToUpper().PadRight(10)) " -NoNewline
        Write-Host "$($c.state.PadRight(10))" -ForegroundColor $stateColor -NoNewline
        Write-Host " | Failures: $($c.failure_count) | Last: $(if ($c.last_failure) { $c.last_failure.Substring(11,8) } else { 'never' })"
    }
}

function Get-CircuitStatusJson {
    <#
    .SYNOPSIS
    Return circuit status as JSON for dashboard.
    #>
    $circuits = Get-Circuits
    if (-not $circuits) { return "{}" }
    
    $status = @{}
    foreach ($api in $circuits.circuits.PSObject.Properties.Name) {
        $c = $circuits.circuits.$api
        $status[$api] = @{
            state = $c.state
            failures = $c.failure_count
            lastFailure = $c.last_failure
            lastSuccess = $c.last_success
        }
    }
    return $status | ConvertTo-Json -Compress
}

# Functions available after dot-sourcing:
# Test-Circuit, Record-Success, Record-Failure, Reset-Circuit, Get-CircuitStatus, Get-CircuitStatusJson
