$tasks = Get-Content 'C:\dev\FsuelsBot\workspace\memory\tasks.json' | ConvertFrom-Json

# Remove T034 from done_today (I put it there by mistake)
$tasks.lanes.done_today = $tasks.lanes.done_today | Where-Object { $_ -ne 'T034' }

# Move T034 to human queue for verification
$tasks.lanes.human = @('T034') + $tasks.lanes.human

# T004 stays in bot_current
$tasks.lanes.bot_current = @('T004')

# Update T034 status to waiting
$tasks.tasks.T034.status = 'waiting_verification'

$tasks.version = $tasks.version + 1
$tasks.updated_at = (Get-Date).ToString('o')
$tasks | ConvertTo-Json -Depth 10 | Set-Content 'C:\dev\FsuelsBot\workspace\memory\tasks.json'
Write-Output 'T034 moved to human queue for verification'
