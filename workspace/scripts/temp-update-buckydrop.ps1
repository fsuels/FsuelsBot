$json = Get-Content 'memory/tasks.json' | ConvertFrom-Json

# Update task
$task = $json.tasks.'CRON-20260130-buckydrop-check'
$task.status = 'done'
$task.learnings.verdict = 'Found responses from Scott Zhou (1/28) about stuck orders and inactive store removal. No new support replies today (1/30).'
$task.learnings.outcomes = @('BuckyDrop support had replied on 1/27-1/28 to both issues')
$task.learnings.actionsTaken = @('Searched Outlook for from:buckydrop', 'Found multiple replies from Scott Zhou and automated notifications')

# Move from bot_queue to done_today
$json.lanes.bot_queue = @($json.lanes.bot_queue | Where-Object { $_ -ne 'CRON-20260130-buckydrop-check' })
$json.lanes.done_today = @('CRON-20260130-buckydrop-check') + $json.lanes.done_today

# Update metadata
$json.version = $json.version + 1
$json.updated_at = (Get-Date).ToUniversalTime().ToString('o')
$json.updated_by = 'bot-heartbeat'

# Save
$json | ConvertTo-Json -Depth 20 | Set-Content 'memory/tasks.json'
Write-Host 'Task marked complete'
