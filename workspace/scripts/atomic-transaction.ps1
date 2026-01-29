# atomic-transaction.ps1
# Atomic multi-file transaction system for memory files
# Council-designed: Grade A+ (WAL pattern)

$script:TXN_DIR = "memory/.txn"
$script:MANIFEST_PATH = "$script:TXN_DIR/current.json"

function New-Transaction {
    param(
        [Parameter(Mandatory)]
        [hashtable[]]$Files
    )
    
    if (-not (Test-Path $script:TXN_DIR)) {
        New-Item -Path $script:TXN_DIR -ItemType Directory -Force | Out-Null
    }
    
    if (Test-Path $script:MANIFEST_PATH) {
        Write-Warning "Incomplete transaction found. Running recovery..."
        Invoke-TransactionRecovery
    }
    
    $txnId = "TXN-$(Get-Date -Format 'yyyyMMdd-HHmmss')-$([guid]::NewGuid().ToString().Substring(0,6))"
    
    $manifest = @{
        txn_id = $txnId
        started_at = (Get-Date).ToUniversalTime().ToString("o")
        files = @()
        phase = "preparing"
        version = 1
    }
    
    foreach ($file in $Files) {
        $fileName = Split-Path $file.Path -Leaf
        $manifest.files += @{
            path = $file.Path
            temp_path = "$script:TXN_DIR/$fileName.tmp"
            backup_path = "$script:TXN_DIR/$fileName.bak"
            checksum = $null
            mode = if ($file.Mode) { $file.Mode } else { "replace" }
            content = $file.Content
        }
    }
    
    $manifest | ConvertTo-Json -Depth 10 | Set-Content -Path $script:MANIFEST_PATH -Encoding UTF8
    return $manifest
}

function Write-TransactionFiles {
    param([hashtable]$Manifest)
    
    foreach ($file in $Manifest.files) {
        if (Test-Path $file.path) {
            Copy-Item -Path $file.path -Destination $file.backup_path -Force
        }
        
        if ($file.mode -eq "append" -and (Test-Path $file.path)) {
            $existingContent = Get-Content -Path $file.path -Raw -ErrorAction SilentlyContinue
            $newContent = if ($existingContent) { "$existingContent`n$($file.content)" } else { $file.content }
            $newContent | Set-Content -Path $file.temp_path -Encoding UTF8 -NoNewline
        } else {
            $file.content | Set-Content -Path $file.temp_path -Encoding UTF8 -NoNewline
        }
        
        $file.checksum = (Get-FileHash -Path $file.temp_path -Algorithm SHA256).Hash
        $file.Remove('content')
    }
    
    $Manifest | ConvertTo-Json -Depth 10 | Set-Content -Path $script:MANIFEST_PATH -Encoding UTF8
}

function Invoke-TransactionCommit {
    param([hashtable]$Manifest)
    
    $Manifest.phase = "committing"
    $Manifest | ConvertTo-Json -Depth 10 | Set-Content -Path $script:MANIFEST_PATH -Encoding UTF8
    
    foreach ($file in $Manifest.files) {
        if (Test-Path $file.temp_path) {
            Move-Item -Path $file.temp_path -Destination $file.path -Force
        }
    }
    
    foreach ($file in $Manifest.files) {
        $actualHash = (Get-FileHash -Path $file.path -Algorithm SHA256).Hash
        if ($actualHash -ne $file.checksum) {
            throw "Checksum verification failed for $($file.path)"
        }
    }
}

function Complete-Transaction {
    param([hashtable]$Manifest)
    
    $Manifest.phase = "completing"
    $Manifest | ConvertTo-Json -Depth 10 | Set-Content -Path $script:MANIFEST_PATH -Encoding UTF8
    
    foreach ($file in $Manifest.files) {
        if (Test-Path $file.backup_path) {
            Remove-Item -Path $file.backup_path -Force
        }
    }
    
    Remove-Item -Path $script:MANIFEST_PATH -Force
}

function Invoke-TransactionRecovery {
    if (-not (Test-Path $script:MANIFEST_PATH)) {
        Write-Host "No incomplete transaction found."
        return $true
    }
    
    $manifest = Get-Content -Path $script:MANIFEST_PATH -Raw | ConvertFrom-Json -AsHashtable
    Write-Host "Recovering transaction $($manifest.txn_id) from phase: $($manifest.phase)"
    
    switch ($manifest.phase) {
        "preparing" {
            Write-Host "Transaction was in PREPARING phase. Cleaning up..."
            foreach ($file in $manifest.files) {
                if (Test-Path $file.temp_path) { Remove-Item -Path $file.temp_path -Force }
                if (Test-Path $file.backup_path) { Remove-Item -Path $file.backup_path -Force }
            }
            Remove-Item -Path $script:MANIFEST_PATH -Force
            Write-Host "Cleanup complete. Original files untouched."
        }
        "committing" {
            Write-Host "Transaction was in COMMITTING phase. Resuming..."
            foreach ($file in $manifest.files) {
                if (Test-Path $file.temp_path) {
                    Move-Item -Path $file.temp_path -Destination $file.path -Force
                    Write-Host "Committed: $($file.path)"
                }
            }
            Complete-Transaction -Manifest $manifest
            Write-Host "Recovery complete. All files committed."
        }
        "completing" {
            Write-Host "Transaction was in COMPLETING phase. Finishing cleanup..."
            Complete-Transaction -Manifest $manifest
            Write-Host "Cleanup complete."
        }
        default {
            Write-Error "Unknown transaction phase: $($manifest.phase)"
            return $false
        }
    }
    return $true
}

function Invoke-AtomicCheckpoint {
    param(
        [Parameter(Mandatory)][hashtable]$State,
        [Parameter(Mandatory)][hashtable]$Tasks,
        [Parameter(Mandatory)][string]$Thread,
        [string]$Event
    )
    
    $files = @(
        @{ Path = "memory/state.json"; Content = ($State | ConvertTo-Json -Depth 20); Mode = "replace" },
        @{ Path = "memory/tasks.json"; Content = ($Tasks | ConvertTo-Json -Depth 20); Mode = "replace" },
        @{ Path = "memory/active-thread.md"; Content = $Thread; Mode = "replace" }
    )
    
    if ($Event) {
        $files += @{ Path = "memory/events.jsonl"; Content = $Event; Mode = "append" }
    }
    
    try {
        $txn = New-Transaction -Files $files
        Write-TransactionFiles -Manifest $txn
        Invoke-TransactionCommit -Manifest $txn
        Complete-Transaction -Manifest $txn
        Write-Host "Checkpoint saved: $($txn.txn_id)"
        return $true
    }
    catch {
        Write-Error "Checkpoint failed: $_"
        try {
            $manifest = Get-Content -Path $script:MANIFEST_PATH -Raw | ConvertFrom-Json -AsHashtable
            foreach ($file in $manifest.files) {
                if (Test-Path $file.backup_path) {
                    Move-Item -Path $file.backup_path -Destination $file.path -Force
                }
            }
            Remove-Item -Path "$script:TXN_DIR/*" -Force -ErrorAction SilentlyContinue
            Write-Host "Rollback complete."
        } catch {
            Write-Error "Rollback also failed: $_"
        }
        return $false
    }
}

# Export functions
Export-ModuleMember -Function New-Transaction, Write-TransactionFiles, Invoke-TransactionCommit, Complete-Transaction, Invoke-TransactionRecovery, Invoke-AtomicCheckpoint
