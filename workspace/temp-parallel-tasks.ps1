$tasks = Get-Content 'memory/tasks.json' -Raw | ConvertFrom-Json

# T060 - Avatar/Banner images
$t060 = @{
    title = "Generate GhostBrokerAI Avatar & Banner Images"
    status = "pending"
    created = (Get-Date).ToString('o')
    context = @{
        summary = "Create professional AI-generated images for GhostBrokerAI brand identity across all platforms"
        decisions = @("Ghost/phantom aesthetic", "Professional but mysterious", "Agent economy theme")
    }
}

# T061 - Council Briefing on Ghost Broker progress
$t061 = @{
    title = "Council Briefing - Ghost Broker Progress & Task Planning"
    status = "pending"
    created = (Get-Date).ToString('o')
    context = @{
        summary = "Present Ghost Broker progress to Council, brainstorm next steps, prioritize task queue"
    }
}

$tasks.tasks | Add-Member -NotePropertyName "T060" -NotePropertyValue $t060 -Force
$tasks.tasks | Add-Member -NotePropertyName "T061" -NotePropertyValue $t061 -Force
$tasks.lanes.bot_queue += @("T060", "T061")
$tasks.version = $tasks.version + 1
$tasks.updated_at = (Get-Date).ToString('o')

$tasks | ConvertTo-Json -Depth 20 | Set-Content 'memory/tasks.json'
Write-Host "T060 and T061 created"
