$t = Get-Content 'memory/tasks.json' -Raw | ConvertFrom-Json

# Update T173 step 9 to done
$t.tasks.T173.steps[8].status = 'done'
$t.tasks.T173.steps[8].completed_at = (Get-Date).ToString('o')
$t.tasks.T173.steps[8] | Add-Member -NotePropertyName 'artifacts' -NotePropertyValue @('https://x.com/GhostBrokerAI/status/2017687540900233242') -Force
$t.tasks.T173.status = 'done'

# Move T173 from bot_current to done_today
$t.lanes.bot_current = @($t.lanes.bot_current | Where-Object { $_ -ne 'T173' })
$t.lanes.done_today = @('T173') + $t.lanes.done_today

# Update version
$t.version = $t.version + 1
$t.updated_at = (Get-Date).ToString('o')

# Save
$t | ConvertTo-Json -Depth 20 | Set-Content 'memory/tasks.json'
Write-Host "T173 marked complete"
