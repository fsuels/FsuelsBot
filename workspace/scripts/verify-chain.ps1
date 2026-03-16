<#
.SYNOPSIS
    Verify or initialize hash-chained audit log integrity.

.DESCRIPTION
    PowerShell wrapper for the hash-chain.js Node.js module.
    Provides human-friendly output for chain verification.

.PARAMETER Path
    Path to the events.jsonl file. Default: memory/events.jsonl

.PARAMETER Init
    Initialize a new hash chain (run ONCE when setting up)

.PARAMETER Json
    Output raw JSON instead of human-friendly text

.EXAMPLE
    .\verify-chain.ps1
    # Verify the default events.jsonl

.EXAMPLE
    .\verify-chain.ps1 -Init
    # Initialize hash chain (first time setup)

.EXAMPLE
    .\verify-chain.ps1 -Path "backup/events.jsonl"
    # Verify a specific file
#>

param(
    [string]$Path = "memory/events.jsonl",
    [switch]$Init,
    [switch]$Json
)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$jsPath = Join-Path $scriptDir "hash-chain.cjs"

# Resolve relative paths from workspace root
$workspaceRoot = Split-Path -Parent $scriptDir
Push-Location $workspaceRoot

try {
    if ($Init) {
        # Initialize hash chain
        Write-Host "Initializing hash chain for: $Path" -ForegroundColor Cyan
        node $jsPath init $Path
        if ($LASTEXITCODE -ne 0) {
            Write-Host "❌ Initialization failed" -ForegroundColor Red
            exit 1
        }
    }
    else {
        # Verify chain
        $output = node $jsPath verify $Path 2>&1
        $result = $output | ConvertFrom-Json
        
        if ($Json) {
            # Raw JSON output
            Write-Output ($result | ConvertTo-Json -Depth 10)
        }
        else {
            # Human-friendly output
            Write-Host ""
            Write-Host "═══════════════════════════════════════════" -ForegroundColor Gray
            Write-Host "  HASH CHAIN VERIFICATION REPORT" -ForegroundColor White
            Write-Host "═══════════════════════════════════════════" -ForegroundColor Gray
            Write-Host "  File: $Path" -ForegroundColor Gray
            Write-Host ""
            
            if ($result.valid) {
                Write-Host "  ✅ CHAIN INTEGRITY: VERIFIED" -ForegroundColor Green
                Write-Host ""
                Write-Host "  📊 Statistics:" -ForegroundColor Cyan
                Write-Host "     Total events:  $($result.eventsChecked)" -ForegroundColor White
                Write-Host "     Legacy events: $($result.legacyEvents)" -ForegroundColor Yellow
                Write-Host "     Hashed events: $($result.hashedEvents)" -ForegroundColor Green
                
                if ($result.chainInitialized) {
                    Write-Host ""
                    Write-Host "  🔗 Chain Status: ACTIVE" -ForegroundColor Green
                } else {
                    Write-Host ""
                    Write-Host "  ⚠️  Chain Status: NOT INITIALIZED" -ForegroundColor Yellow
                    Write-Host "     Run with -Init to start hash chaining" -ForegroundColor Gray
                }
            }
            else {
                Write-Host "  ❌ CHAIN INTEGRITY: FAILED" -ForegroundColor Red
                Write-Host ""
                Write-Host "  ⚠️  TAMPERING DETECTED!" -ForegroundColor Red
                Write-Host ""
                Write-Host "  Errors found:" -ForegroundColor Yellow
                
                foreach ($err in $result.errors) {
                    Write-Host ""
                    if ($err.line) {
                        Write-Host "     Line $($err.line):" -ForegroundColor White
                    }
                    Write-Host "     $($err.error)" -ForegroundColor Red
                    if ($err.eventId) {
                        Write-Host "     Event ID: $($err.eventId)" -ForegroundColor Gray
                    }
                }
            }
            
            Write-Host ""
            Write-Host "═══════════════════════════════════════════" -ForegroundColor Gray
            Write-Host ""
        }
        
        exit ($result.valid ? 0 : 1)
    }
}
finally {
    Pop-Location
}
