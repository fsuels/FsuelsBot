# Update T180 to done, T174 step progress
$tasks = Get-Content 'C:\dev\FsuelsBot\workspace\memory\tasks.json' -Raw | ConvertFrom-Json

# Move T180 to done_today
$tasks.tasks.T180.status = 'done'
$tasks.lanes.bot_current = @($tasks.lanes.bot_current | Where-Object { $_ -ne 'T180' })
$tasks.lanes.done_today = @('T180') + $tasks.lanes.done_today

# Update version
$tasks.version = $tasks.version + 1
$tasks.updated_at = (Get-Date).ToString('o')

$tasks | ConvertTo-Json -Depth 20 | Set-Content 'C:\dev\FsuelsBot\workspace\memory\tasks.json' -Encoding UTF8
Write-Host "T180 moved to done_today"
