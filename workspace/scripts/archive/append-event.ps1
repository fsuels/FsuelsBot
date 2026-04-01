# append-event.ps1
# Wrapper to append events to events.jsonl WITH hash-chain integrity
# Usage: . .\scripts\append-event.ps1; Add-HashedEvent -Id "EVT-XXX" -Type "fact" -Content "..." -Tags @("tag1")

$script:EVENTS_FILE = "memory/events.jsonl"
$script:HASH_CHAIN_SCRIPT = "scripts/hash-chain.cjs"

function Add-HashedEvent {
    <#
    .SYNOPSIS
    Append an event to events.jsonl with proper hash-chain linking.
    #>
    param(
        [Parameter(Mandatory)][string]$Id,
        [Parameter(Mandatory)][string]$Type,
        [Parameter(Mandatory)][string]$Content,
        [string]$Priority = "P2",
        [string]$Session = "main",
        [string[]]$Tags = @()
    )
    
    # Build event JSON
    $event = @{
        ts = (Get-Date).ToUniversalTime().ToString("o")
        id = $Id
        type = $Type
        priority = $Priority
        content = $Content
        session = $Session
        tags = $Tags
    }
    
    $eventJson = $event | ConvertTo-Json -Compress
    
    # Call Node.js to append with hash
    $result = node -e "
        const hc = require('./scripts/hash-chain.cjs');
        const event = JSON.parse(process.argv[1]);
        try {
            const result = hc.appendEvent('$script:EVENTS_FILE', event);
            console.log(JSON.stringify({success: true, hash: result.hash}));
        } catch (e) {
            console.log(JSON.stringify({success: false, error: e.message}));
        }
    " $eventJson 2>&1
    
    try {
        $parsed = $result | ConvertFrom-Json
        if ($parsed.success) {
            Write-Host "[OK] Event $Id appended with hash $($parsed.hash)" -ForegroundColor Green
            return $true
        } else {
            Write-Host "[!!] Failed to append event: $($parsed.error)" -ForegroundColor Red
            return $false
        }
    } catch {
        Write-Host "[!!] Hash-chain error: $result" -ForegroundColor Red
        return $false
    }
}

function Repair-HashChain {
    <#
    .SYNOPSIS
    Repair events that were appended without hashes by re-hashing them in place.
    #>
    
    Write-Host "Repairing hash chain..." -ForegroundColor Yellow
    
    # Read all events
    $lines = Get-Content $script:EVENTS_FILE -Encoding UTF8
    $newLines = @()
    $lastHash = $null
    $repaired = 0
    $chainStarted = $false
    
    foreach ($line in $lines) {
        if (-not $line.Trim()) { continue }
        
        try {
            $event = $line | ConvertFrom-Json
        } catch {
            $newLines += $line
            continue
        }
        
        # Check if this is the chain init
        if ($event.type -eq "chain_init" -and $event.hash) {
            $chainStarted = $true
            $lastHash = $event.hash
            $newLines += $line
            continue
        }
        
        # If chain hasn't started, keep as-is (legacy)
        if (-not $chainStarted) {
            $newLines += $line
            continue
        }
        
        # If event already has hash, verify and keep
        if ($event.hash) {
            $lastHash = $event.hash
            $newLines += $line
            continue
        }
        
        # Event after chain_init but missing hash - REPAIR IT
        $event | Add-Member -NotePropertyName "prevHash" -NotePropertyValue $lastHash -Force
        
        # Compute hash using Node.js
        $eventJson = $event | ConvertTo-Json -Compress
        $hash = node -e "
            const hc = require('./scripts/hash-chain.cjs');
            const event = JSON.parse(process.argv[1]);
            console.log(hc.computeHash(event));
        " $eventJson 2>&1
        
        $event | Add-Member -NotePropertyName "hash" -NotePropertyValue $hash.Trim() -Force
        $lastHash = $hash.Trim()
        $repaired++
        
        $newLines += ($event | ConvertTo-Json -Compress)
    }
    
    # Write repaired file
    $tempPath = "$script:EVENTS_FILE.tmp"
    $newLines | Set-Content $tempPath -Encoding UTF8
    Move-Item $tempPath $script:EVENTS_FILE -Force
    
    Write-Host "[OK] Repaired $repaired events" -ForegroundColor Green
    return $repaired
}

# Export for dot-sourcing
