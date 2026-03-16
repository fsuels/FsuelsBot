# collect-errors.ps1
# Automatically collect and analyze Clawdbot errors
# Run on heartbeat or after disconnect to capture what happened

param(
    [switch]$Quiet,
    [int]$TailLines = 100,
    [int]$MaxLogSizeKB = 100  # Rotate when exceeds this size
)

$ErrorLog = "C:\dev\FsuelsBot\workspace\memory\error-log.jsonl"
$ClawdbotLog = "\tmp\clawdbot\clawdbot-$(Get-Date -Format 'yyyy-MM-dd').log"
$Timestamp = Get-Date -Format "yyyy-MM-ddTHH:mm:ssK"

# IMPROVEMENT: Log rotation when file gets too big
if (Test-Path $ErrorLog) {
    $logSize = (Get-Item $ErrorLog).Length / 1KB
    if ($logSize -gt $MaxLogSizeKB) {
        $archiveName = $ErrorLog -replace '\.jsonl$', "-$(Get-Date -Format 'yyyy-MM-dd').jsonl"
        Move-Item $ErrorLog $archiveName -Force
        if (-not $Quiet) { Write-Host "Rotated error log ($([math]::Round($logSize))KB)" -ForegroundColor Yellow }
    }
}

# IMPROVEMENT: Noise patterns to SKIP (not actionable)
$NoisePatterns = @(
    "TypeError: fetch failed",           # Network timeouts - normal
    "AbortError",                         # Request cancelled - normal
    "context deadline exceeded",          # Timeout - normal
    "ECONNRESET",                         # Connection reset - normal
    "socket hang up"                      # Socket closed - normal
)

# Ensure error log directory exists
$ErrorLogDir = Split-Path $ErrorLog -Parent
if (-not (Test-Path $ErrorLogDir)) {
    New-Item -ItemType Directory -Path $ErrorLogDir -Force | Out-Null
}

# Collect errors from Clawdbot log
$Errors = @()

if (Test-Path $ClawdbotLog) {
    $LogContent = Get-Content $ClawdbotLog -Tail $TailLines -ErrorAction SilentlyContinue
    
    # Find error patterns (actionable ones only)
    $ErrorPatterns = @(
        "UnhandledPromiseRejectionWarning",
        "Error:",
        "failed:",
        "ENOENT",                             # File not found - usually a bug
        "ECONNREFUSED"                        # Connection refused - service down
        # Note: timeout, fetch failed, AbortError filtered as noise above
    )
    
    foreach ($line in $LogContent) {
        # IMPROVEMENT: Skip noise patterns first
        $isNoise = $false
        foreach ($noise in $NoisePatterns) {
            if ($line -match [regex]::Escape($noise)) { $isNoise = $true; break }
        }
        if ($isNoise) { continue }
        
        foreach ($pattern in $ErrorPatterns) {
            if ($line -match $pattern) {
                $Errors += @{
                    timestamp = $Timestamp
                    source = "clawdbot-log"
                    pattern = $pattern
                    line = $line.Trim()
                }
                break
            }
        }
    }
}

# Check for recent Windows errors
try {
    $WinErrors = Get-EventLog -LogName Application -Newest 5 -EntryType Error -ErrorAction SilentlyContinue |
        Where-Object { $_.TimeGenerated -gt (Get-Date).AddMinutes(-30) } |
        ForEach-Object {
            @{
                timestamp = $Timestamp
                source = "windows-eventlog"
                pattern = $_.Source
                line = $_.Message.Substring(0, [Math]::Min(200, $_.Message.Length))
            }
        }
    $Errors += $WinErrors
} catch {
    # Ignore if can't read event log
}

# Output summary
if (-not $Quiet) {
    if ($Errors.Count -eq 0) {
        Write-Host "No recent errors found" -ForegroundColor Green
    } else {
        Write-Host "Found $($Errors.Count) errors:" -ForegroundColor Yellow
        foreach ($err in $Errors) {
            Write-Host "  [$($err.pattern)] $($err.line.Substring(0, [Math]::Min(80, $err.line.Length)))..." -ForegroundColor Red
        }
    }
}

# IMPROVEMENT: Deduplicate before logging
$NewErrors = 0
$LastSeenFile = "C:\dev\FsuelsBot\workspace\memory\.last-error-check.json"
$LastSeenLines = @()

if (Test-Path $LastSeenFile) {
    try {
        $LastSeen = Get-Content $LastSeenFile -Raw | ConvertFrom-Json
        $LastSeenLines = $LastSeen.lines
    } catch {}
}

foreach ($err in $Errors) {
    # Skip if we've seen this exact error line before
    $lineHash = [System.BitConverter]::ToString([System.Security.Cryptography.MD5]::Create().ComputeHash([System.Text.Encoding]::UTF8.GetBytes($err.line))).Replace("-","").Substring(0,16)
    if ($LastSeenLines -contains $lineHash) { continue }
    
    $json = $err | ConvertTo-Json -Compress
    Add-Content -Path $ErrorLog -Value $json
    $LastSeenLines += $lineHash
    $NewErrors++
}

# Save last seen (keep last 500 hashes)
if ($LastSeenLines.Count -gt 500) { $LastSeenLines = $LastSeenLines[-500..-1] }
@{ lines = $LastSeenLines; updated = (Get-Date).ToString("o") } | ConvertTo-Json | Set-Content $LastSeenFile

# Return NEW error count for scripting
return $NewErrors
