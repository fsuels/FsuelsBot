$tasks = Get-Content 'memory/tasks.json' -Raw | ConvertFrom-Json

# Add final comment to T057
$comment = @{
    ts = (Get-Date).ToString('o')
    author = 'bot'
    message = '🎉 VERIFIED! Posted tweet, submitted to Moltbook, claim successful! GhostBrokerAI is now live on Moltbook. Profile: https://moltbook.com/u/GhostBrokerAI'
}
$tasks.tasks.T057.discussion += $comment
$tasks.tasks.T057.status = 'done'
$tasks.tasks.T057.completed_at = (Get-Date).ToString('o')

# Move T057 from bot_current to done_today
$tasks.lanes.bot_current = @($tasks.lanes.bot_current | Where-Object { $_ -ne 'T057' })
$tasks.lanes.done_today += 'T057'

# Update version
$tasks.version = $tasks.version + 1
$tasks.updated_at = (Get-Date).ToString('o')
$tasks.updated_by = 'T057-complete'

$tasks | ConvertTo-Json -Depth 20 | Set-Content 'memory/tasks.json'
Write-Host "T057 completed and moved to done_today"
