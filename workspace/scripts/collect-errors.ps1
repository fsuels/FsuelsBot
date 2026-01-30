# collect-errors.ps1
# Automatically collect and analyze Clawdbot errors
# Run on heartbeat or after disconnect to capture what happened

param(
    [switch]$Quiet,
    [int]$TailLines = 100
)

$ErrorLog = "C:\dev\FsuelsBot\workspace\memory\error-log.jsonl"
$ClawdbotLog = "\tmp\clawdbot\clawdbot-$(Get-Date -Format 'yyyy-MM-dd').log"
$Timestamp = Get-Date -Format "yyyy-MM-ddTHH:mm:ssK"

# Ensure error log directory exists
$ErrorLogDir = Split-Path $ErrorLog -Parent
if (-not (Test-Path $ErrorLogDir)) {
    New-Item -ItemType Directory -Path $ErrorLogDir -Force | Out-Null
}

# Collect errors from Clawdbot log
$Errors = @()

if (Test-Path $ClawdbotLog) {
    $LogContent = Get-Content $ClawdbotLog -Tail $TailLines -ErrorAction SilentlyContinue
    
    # Find error patterns
    $ErrorPatterns = @(
        "UnhandledPromiseRejectionWarning",
        "TypeError: fetch failed",
        "AbortError",
        "Error:",
        "failed:",
        "ENOENT",
        "ECONNREFUSED",
        "timeout"
    )
    
    foreach ($line in $LogContent) {
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

# Append to error log (JSONL format)
foreach ($err in $Errors) {
    $json = $err | ConvertTo-Json -Compress
    Add-Content -Path $ErrorLog -Value $json
}

# Return error count for scripting
return $Errors.Count
