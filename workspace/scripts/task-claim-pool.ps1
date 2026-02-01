# Task Claim Pool System
# Manages priority scoring, agent claims, and parallel execution

param(
    [Parameter(Position=0)]
    [ValidateSet('calculate-priorities', 'claim', 'release', 'status', 'available', 'heartbeat')]
    [string]$Action = 'status',
    
    [string]$TaskId,
    [string]$AgentId,
    [string]$AgentName,
    [ValidateSet('research', 'content', 'audit', 'analytics', 'code', 'general')]
    [string]$Specialty = 'general'
)

$ErrorActionPreference = 'Stop'
$tasksPath = Join-Path $PSScriptRoot '..\memory\tasks.json'
$parallelLogPath = Join-Path $PSScriptRoot '..\memory\parallel-execution.jsonl'

# Load tasks.json
function Get-Tasks {
    if (Test-Path $tasksPath) {
        $content = Get-Content $tasksPath -Raw -Encoding UTF8
        # Use Python for JSON parsing (more reliable with older PowerShell)
        $python = 'import json,sys; d=json.load(sys.stdin); print(json.dumps(d))'
        $result = $content | python -c $python 2>$null
        if ($result) {
            # PowerShell 5.1 doesn't have -AsHashtable, so we convert manually
            return $content | ConvertFrom-Json
        }
        # Fallback: direct parse
        return $content | ConvertFrom-Json
    }
    throw "tasks.json not found at $tasksPath"
}

# Save tasks.json atomically
function Save-Tasks {
    param([hashtable]$Data)
    
    $Data.version = [int]$Data.version + 1
    $Data.updated_at = (Get-Date).ToString('o')
    $Data.updated_by = 'task-claim-pool'
    
    $tempPath = "$tasksPath.tmp"
    $Data | ConvertTo-Json -Depth 20 | Set-Content $tempPath -Encoding UTF8
    Move-Item $tempPath $tasksPath -Force
}

# Log parallel execution event
function Log-ParallelEvent {
    param([hashtable]$Event)
    
    $Event.timestamp = (Get-Date).ToString('o')
    $line = $Event | ConvertTo-Json -Compress
    Add-Content $parallelLogPath $line -Encoding UTF8
}

# Calculate urgency score based on due date
function Get-UrgencyScore {
    param([string]$DueDate)
    
    if (-not $DueDate) { return 0 }
    
    try {
        $due = [DateTime]::Parse($DueDate)
        $now = Get-Date
        $daysUntilDue = ($due - $now).TotalDays
        
        if ($daysUntilDue -lt 0) { return 40 }      # Past due
        if ($daysUntilDue -lt 1) { return 30 }      # Within 24h
        if ($daysUntilDue -lt 3) { return 20 }      # Within 3 days
        if ($daysUntilDue -lt 7) { return 10 }      # Within 7 days
        return 0
    } catch {
        return 0
    }
}

# Calculate impact score
function Get-ImpactScore {
    param([string]$Impact)
    
    switch ($Impact) {
        'critical' { return 40 }
        'high'     { return 30 }
        'medium'   { return 20 }
        'low'      { return 10 }
        default    { return 0 }
    }
}

# Calculate dependency boost
function Get-DependencyBoost {
    param([array]$Blocks)
    
    $count = if ($Blocks) { $Blocks.Count } else { 0 }
    
    if ($count -ge 3) { return 20 }
    if ($count -ge 1) { return 10 }
    return 0
}

# Get priority level from score
function Get-PriorityLevel {
    param([int]$Score)
    
    if ($Score -ge 80) { return 'P0' }
    if ($Score -ge 60) { return 'P1' }
    if ($Score -ge 40) { return 'P2' }
    if ($Score -ge 20) { return 'P3' }
    return 'P4'
}

# Calculate all priority scores
function Update-AllPriorities {
    $data = Get-Tasks
    $updated = 0
    
    foreach ($taskId in $data.tasks.Keys) {
        $task = $data.tasks[$taskId]
        
        # Skip if not pending/in_progress
        if ($task.status -notin @('pending', 'in_progress', $null)) { continue }
        
        # Calculate scores
        $urgency = Get-UrgencyScore -DueDate $task.due_date
        $impactLevel = if ($task.priority.impact) { $task.priority.impact } else { 'medium' }
        $impactScore = Get-ImpactScore -Impact $impactLevel
        $dependencyBoost = Get-DependencyBoost -Blocks $task.blocks
        
        $totalScore = $urgency + $impactScore + $dependencyBoost
        $priorityLevel = Get-PriorityLevel -Score $totalScore
        
        # Update task
        if (-not $task.priority) {
            $task.priority = @{}
        }
        $task.priority.urgency = $urgency
        $task.priority.impact = $impactLevel
        $task.priority.impact_score = $impactScore
        $task.priority.dependency_boost = $dependencyBoost
        $task.priority.total_score = $totalScore
        $task.priority.priority_level = $priorityLevel
        $task.priority.calculated_at = (Get-Date).ToString('o')
        
        $updated++
    }
    
    Save-Tasks -Data $data
    Write-Host "Updated priorities for $updated tasks"
    return $data
}

# Get available tasks for a specialty
function Get-AvailableTasks {
    param([string]$Specialty)
    
    $data = Get-Tasks
    $available = @()
    
    foreach ($taskId in $data.lanes.bot_queue) {
        $task = $data.tasks[$taskId]
        if (-not $task) { continue }
        
        # Check if already claimed
        if ($task.claimed_by -and $task.claimed_by.agent_id) {
            # Check for stale claim (30 min timeout)
            if ($task.claimed_by.last_heartbeat) {
                $lastHb = [DateTime]::Parse($task.claimed_by.last_heartbeat)
                $minutesAgo = ((Get-Date) - $lastHb).TotalMinutes
                if ($minutesAgo -lt 30) {
                    continue  # Still claimed
                }
                # Stale claim - auto-release
                Write-Host "Auto-releasing stale claim on $taskId"
                $task.claimed_by = $null
            }
        }
        
        # Check specialty match
        $requiredAgent = if ($task.required_agent) { $task.required_agent } else { 'general' }
        if ($Specialty -ne 'general' -and $requiredAgent -ne 'general' -and $requiredAgent -ne $Specialty) {
            continue
        }
        
        # Add to available list
        $priority = if ($task.priority.total_score) { $task.priority.total_score } else { 0 }
        $available += [PSCustomObject]@{
            TaskId = $taskId
            Title = $task.title
            RequiredAgent = $requiredAgent
            PriorityScore = $priority
            PriorityLevel = if ($task.priority.priority_level) { $task.priority.priority_level } else { 'P4' }
        }
    }
    
    # Sort by priority descending
    $available = $available | Sort-Object -Property PriorityScore -Descending
    return $available
}

# Claim a task
function Claim-Task {
    param([string]$TaskId, [string]$AgentId, [string]$AgentName, [string]$Specialty)
    
    $data = Get-Tasks
    
    if (-not $data.tasks[$TaskId]) {
        throw "Task $TaskId not found"
    }
    
    $task = $data.tasks[$TaskId]
    
    # Check if already claimed
    if ($task.claimed_by -and $task.claimed_by.agent_id) {
        $lastHb = [DateTime]::Parse($task.claimed_by.last_heartbeat)
        $minutesAgo = ((Get-Date) - $lastHb).TotalMinutes
        if ($minutesAgo -lt 30) {
            throw "Task $TaskId already claimed by $($task.claimed_by.agent_name)"
        }
    }
    
    # Claim it
    $now = (Get-Date).ToString('o')
    $task.claimed_by = @{
        agent_id = $AgentId
        agent_name = $AgentName
        specialty = $Specialty
        claimed_at = $now
        last_heartbeat = $now
    }
    $task.status = 'in_progress'
    
    # Update parallel execution tracking
    if (-not $data.parallel_execution) {
        $data.parallel_execution = @{
            enabled = $true
            max_concurrent = 5
            active_agents = @()
            claim_timeout_minutes = 30
        }
    }
    
    # Add to active agents if not already there
    $existing = $data.parallel_execution.active_agents | Where-Object { $_.agent_id -eq $AgentId }
    if (-not $existing) {
        $data.parallel_execution.active_agents += @{
            agent_id = $AgentId
            agent_name = $AgentName
            specialty = $Specialty
            current_task = $TaskId
            started_at = $now
            last_heartbeat = $now
        }
    } else {
        $existing.current_task = $TaskId
        $existing.last_heartbeat = $now
    }
    
    Save-Tasks -Data $data
    
    Log-ParallelEvent @{
        event = 'claim'
        task_id = $TaskId
        agent_id = $AgentId
        agent_name = $AgentName
        specialty = $Specialty
    }
    
    Write-Host "Task $TaskId claimed by $AgentName ($Specialty)"
    return $task
}

# Release a task back to pool
function Release-Task {
    param([string]$TaskId, [string]$AgentId, [string]$Reason)
    
    $data = Get-Tasks
    
    if (-not $data.tasks[$TaskId]) {
        throw "Task $TaskId not found"
    }
    
    $task = $data.tasks[$TaskId]
    
    # Verify ownership
    if ($task.claimed_by.agent_id -ne $AgentId) {
        throw "Task $TaskId not owned by agent $AgentId"
    }
    
    # Release it
    $agentName = $task.claimed_by.agent_name
    $task.claimed_by = $null
    $task.status = 'pending'
    
    # Add release note
    if ($Reason) {
        if (-not $task.notes) { $task.notes = '' }
        $task.notes += "`n[Released by $agentName]: $Reason"
    }
    
    # Remove from active agents
    if ($data.parallel_execution -and $data.parallel_execution.active_agents) {
        $data.parallel_execution.active_agents = @(
            $data.parallel_execution.active_agents | Where-Object { $_.agent_id -ne $AgentId }
        )
    }
    
    Save-Tasks -Data $data
    
    Log-ParallelEvent @{
        event = 'release'
        task_id = $TaskId
        agent_id = $AgentId
        reason = $Reason
    }
    
    Write-Host "Task $TaskId released back to pool"
}

# Heartbeat to keep claim alive
function Send-Heartbeat {
    param([string]$AgentId)
    
    $data = Get-Tasks
    $now = (Get-Date).ToString('o')
    
    # Update all tasks claimed by this agent
    foreach ($taskId in $data.tasks.Keys) {
        $task = $data.tasks[$taskId]
        if ($task.claimed_by -and $task.claimed_by.agent_id -eq $AgentId) {
            $task.claimed_by.last_heartbeat = $now
        }
    }
    
    # Update active agent entry
    if ($data.parallel_execution -and $data.parallel_execution.active_agents) {
        foreach ($agent in $data.parallel_execution.active_agents) {
            if ($agent.agent_id -eq $AgentId) {
                $agent.last_heartbeat = $now
            }
        }
    }
    
    Save-Tasks -Data $data
    Write-Host "Heartbeat sent for agent $AgentId"
}

# Get current status
function Get-ClaimStatus {
    $data = Get-Tasks
    
    Write-Host "`n=== Task Claim Pool Status ===" -ForegroundColor Cyan
    
    # Active agents
    if ($data.parallel_execution -and $data.parallel_execution.active_agents) {
        $activeCount = $data.parallel_execution.active_agents.Count
        Write-Host "`nActive Agents: $activeCount / $($data.parallel_execution.max_concurrent)" -ForegroundColor Green
        
        foreach ($agent in $data.parallel_execution.active_agents) {
            $task = $data.tasks[$agent.current_task]
            $taskTitle = if ($task) { $task.title } else { 'Unknown' }
            Write-Host "  - $($agent.agent_name) [$($agent.specialty)]: $($agent.current_task) - $taskTitle"
        }
    } else {
        Write-Host "`nNo active agents" -ForegroundColor Yellow
    }
    
    # Queue summary by specialty
    Write-Host "`nQueue by Specialty:" -ForegroundColor Cyan
    $bySpecialty = @{}
    foreach ($taskId in $data.lanes.bot_queue) {
        $task = $data.tasks[$taskId]
        if (-not $task) { continue }
        $spec = if ($task.required_agent) { $task.required_agent } else { 'general' }
        if (-not $bySpecialty[$spec]) { $bySpecialty[$spec] = 0 }
        $bySpecialty[$spec]++
    }
    foreach ($spec in $bySpecialty.Keys | Sort-Object) {
        $count = $bySpecialty[$spec]
        Write-Host "  - ${spec}: ${count} tasks"
    }
    
    # Priority distribution
    Write-Host "`nPriority Distribution:" -ForegroundColor Cyan
    $byPriority = @{ P0=0; P1=0; P2=0; P3=0; P4=0 }
    foreach ($taskId in $data.lanes.bot_queue) {
        $task = $data.tasks[$taskId]
        if (-not $task) { continue }
        $level = if ($task.priority.priority_level) { $task.priority.priority_level } else { 'P4' }
        $byPriority[$level]++
    }
    foreach ($p in @('P0','P1','P2','P3','P4')) {
        $color = switch($p) { 'P0' { 'Red' } 'P1' { 'DarkYellow' } 'P2' { 'Yellow' } default { 'Gray' } }
        $count = $byPriority[$p]
        Write-Host "  - ${p}: ${count} tasks" -ForegroundColor $color
    }
}

# Execute action
switch ($Action) {
    'calculate-priorities' {
        Update-AllPriorities
    }
    'claim' {
        if (-not $TaskId -or -not $AgentId -or -not $AgentName) {
            throw "claim requires -TaskId, -AgentId, -AgentName"
        }
        Claim-Task -TaskId $TaskId -AgentId $AgentId -AgentName $AgentName -Specialty $Specialty
    }
    'release' {
        if (-not $TaskId -or -not $AgentId) {
            throw "release requires -TaskId, -AgentId"
        }
        Release-Task -TaskId $TaskId -AgentId $AgentId -Reason $env:RELEASE_REASON
    }
    'available' {
        $available = Get-AvailableTasks -Specialty $Specialty
        Write-Host "`n=== Available Tasks for '$Specialty' ===" -ForegroundColor Cyan
        foreach ($t in $available) {
            Write-Host "[$($t.PriorityLevel)] $($t.TaskId): $($t.Title) (Score: $($t.PriorityScore), Requires: $($t.RequiredAgent))"
        }
        if ($available.Count -eq 0) {
            Write-Host "No tasks available for specialty: $Specialty" -ForegroundColor Yellow
        }
    }
    'heartbeat' {
        if (-not $AgentId) {
            throw "heartbeat requires -AgentId"
        }
        Send-Heartbeat -AgentId $AgentId
    }
    'status' {
        Get-ClaimStatus
    }
}
