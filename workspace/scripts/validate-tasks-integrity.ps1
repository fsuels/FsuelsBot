<# 
.SYNOPSIS
    Validates tasks.json integrity - ensures all lane references have definitions
.DESCRIPTION  
    Run before ANY write to tasks.json. Blocks corruption from ever persisting.
    Called by: heartbeat checks, pre-commit hooks, any task modification
#>
param(
    [string]$TasksPath = "memory/tasks.json",
    [switch]$Fix,  # Attempt to fix by removing orphan references
    [switch]$Quiet
)

$ErrorActionPreference = "Stop"

try {
    $tasks = Get-Content $TasksPath -Raw | ConvertFrom-Json
    
    # Get all task definitions
    $taskDefs = @($tasks.tasks.PSObject.Properties.Name)
    
    # Get all lane references
    $laneRefs = @(
        $tasks.lanes.bot_current + 
        $tasks.lanes.bot_queue + 
        $tasks.lanes.human + 
        $tasks.lanes.scheduled + 
        $tasks.lanes.done_today
    ) | Where-Object { $_ } | Sort-Object -Unique
    
    # Find missing definitions
    $missing = @($laneRefs | Where-Object { $_ -notin $taskDefs })
    
    # Find orphan definitions (defined but not in any lane)
    $orphans = @($taskDefs | Where-Object { $_ -notin $laneRefs })
    
    $result = @{
        valid = $missing.Count -eq 0
        definitions = $taskDefs.Count
        references = $laneRefs.Count
        missing = $missing
        orphans = $orphans.Count
        timestamp = (Get-Date).ToString("o")
    }
    
    if (-not $Quiet) {
        Write-Host "=== TASKS.JSON INTEGRITY CHECK ===" -ForegroundColor Cyan
        Write-Host "Definitions: $($taskDefs.Count)"
        Write-Host "References: $($laneRefs.Count)"
        Write-Host "Orphans: $($orphans.Count) (defined but not in lanes)"
        
        if ($missing.Count -gt 0) {
            Write-Host "❌ CORRUPTION DETECTED: $($missing.Count) missing definitions" -ForegroundColor Red
            Write-Host "Missing IDs:" -ForegroundColor Red
            $missing | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
            
            if ($Fix) {
                Write-Host "`nAttempting fix..." -ForegroundColor Yellow
                # Remove orphan references from lanes
                foreach ($lane in @("bot_current", "bot_queue", "human", "scheduled", "done_today")) {
                    $tasks.lanes.$lane = @($tasks.lanes.$lane | Where-Object { $_ -in $taskDefs })
                }
                $tasks.updated_at = (Get-Date).ToString("o")
                $tasks.updated_by = "integrity-fix"
                $tasks | ConvertTo-Json -Depth 20 | Set-Content $TasksPath -Encoding UTF8
                Write-Host "✅ Fixed - removed orphan references" -ForegroundColor Green
            }
        } else {
            Write-Host "✅ VALID" -ForegroundColor Green
        }
    }
    
    # Return JSON for programmatic use
    $result | ConvertTo-Json -Compress
    
    # Exit with error code if invalid
    if ($missing.Count -gt 0 -and -not $Fix) {
        exit 1
    }
    
} catch {
    Write-Host "❌ ERROR: $_" -ForegroundColor Red
    exit 2
}
