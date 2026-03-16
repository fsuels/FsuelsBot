# api-wrapper.ps1
# Automatic API call wrapper with circuit breaker integration
# Council A+ upgrade: Auto-wrap API calls with circuit breaker + metrics

. $PSScriptRoot\circuit-breaker.ps1

function Invoke-ProtectedApi {
    <#
    .SYNOPSIS
    Make an API call with automatic circuit breaker protection and metrics.
    
    .PARAMETER Api
    API name (gemini, grok, chatgpt, shopify, buckydrop)
    
    .PARAMETER ScriptBlock
    The actual API call to make
    
    .PARAMETER FallbackValue
    Value to return if circuit is open or call fails
    #>
    param(
        [Parameter(Mandatory)][string]$Api,
        [Parameter(Mandatory)][scriptblock]$ScriptBlock,
        $FallbackValue = $null,
        [int]$TimeoutSeconds = 30
    )
    
    # Check circuit breaker
    $circuit = Test-Circuit -Api $Api
    
    if (-not $circuit.Allowed) {
        Write-Host "[$Api] Circuit OPEN - returning fallback" -ForegroundColor Yellow
        
        # Record skip metric
        python -c "
import sys
sys.path.insert(0, 'scripts')
from metrics import record_metric
record_metric('api_circuit_skip', 1.0, details={'api': '$Api', 'reason': '$($circuit.Reason)'})
" 2>$null
        
        return @{
            Success = $false
            Data = $FallbackValue
            Error = "Circuit open: $($circuit.Reason)"
            Skipped = $true
        }
    }
    
    # Make the actual call
    $startTime = Get-Date
    $result = $null
    $error = $null
    
    try {
        $job = Start-Job -ScriptBlock $ScriptBlock
        $completed = Wait-Job $job -Timeout $TimeoutSeconds
        
        if ($completed) {
            $result = Receive-Job $job
            $success = $true
        } else {
            Stop-Job $job
            Remove-Job $job -Force
            throw "Timeout after ${TimeoutSeconds}s"
        }
        Remove-Job $job -Force -ErrorAction SilentlyContinue
    }
    catch {
        $error = $_.Exception.Message
        $success = $false
    }
    
    $elapsed = ((Get-Date) - $startTime).TotalMilliseconds
    
    # Record result
    if ($success) {
        Record-Success -Api $Api
        
        # Record success metric
        python -c "
import sys
sys.path.insert(0, 'scripts')
from metrics import record_api_call
record_api_call('$Api', True, $([int]$elapsed))
" 2>$null
        
        return @{
            Success = $true
            Data = $result
            LatencyMs = [int]$elapsed
        }
    }
    else {
        # Determine error type
        $errorType = "unknown"
        if ($error -match "429|rate.?limit") { $errorType = "rate_limit" }
        elseif ($error -match "timeout") { $errorType = "timeout" }
        elseif ($error -match "401|403|auth") { $errorType = "auth" }
        elseif ($error -match "500|502|503|504") { $errorType = "server_error" }
        
        Record-Failure -Api $Api -ErrorType $errorType
        
        # Record failure metric
        python -c "
import sys
sys.path.insert(0, 'scripts')
from metrics import record_api_call
record_api_call('$Api', False, $([int]$elapsed))
" 2>$null
        
        return @{
            Success = $false
            Data = $FallbackValue
            Error = $error
            ErrorType = $errorType
            LatencyMs = [int]$elapsed
        }
    }
}

function Invoke-GeminiApi {
    param(
        [Parameter(Mandatory)][string]$Prompt,
        [string]$Model = "gemini-2.5-flash"
    )
    
    Invoke-ProtectedApi -Api "gemini" -ScriptBlock {
        param($p, $m)
        gemini -m $m -p $p 2>&1
    }.GetNewClosure() -FallbackValue "Gemini unavailable"
}

function Test-AllCircuits {
    <#
    .SYNOPSIS
    Quick health check of all circuits for dashboard.
    #>
    $apis = @("gemini", "grok", "chatgpt", "shopify", "buckydrop")
    $results = @{}
    
    foreach ($api in $apis) {
        $circuit = Test-Circuit -Api $api
        $results[$api] = @{
            Allowed = $circuit.Allowed
            Reason = $circuit.Reason
            IsProbe = $circuit.IsProbe
        }
    }
    
    return $results
}

# Export for dot-sourcing
Write-Host "API wrapper loaded. Use Invoke-ProtectedApi for circuit-breaker-protected calls." -ForegroundColor Cyan
