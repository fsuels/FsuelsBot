# Update tasks.json with Task Claim Pool schema
param([string]$WorkspacePath = 'C:\dev\FsuelsBot\workspace')

$tasksPath = Join-Path $WorkspacePath 'memory\tasks.json'
$json = Get-Content $tasksPath -Raw | ConvertFrom-Json -AsHashtable

# Add parallel_execution tracking
if (-not $json['parallel_execution']) {
    $json['parallel_execution'] = @{
        'enabled' = $true
        'max_concurrent' = 5
        'active_agents' = @()
        'claim_timeout_minutes' = 30
    }
}

# Add claim pool schema to notes
$json['notes'] = 'Version 7: Added Task Claim Pool system. Tasks can have required_agent (research/content/audit/analytics/code/general), priority scoring (urgency + impact + dependency_boost), and parallel execution tracking. See procedures/task-claim-pool.md for details.'

# Increment version
$json['version'] = [int]$json['version'] + 1
$json['updated_at'] = (Get-Date).ToString('o')

# Save
$json | ConvertTo-Json -Depth 20 | Set-Content $tasksPath -Encoding UTF8
Write-Host "Updated tasks.json with parallel_execution field (version $($json['version']))"
