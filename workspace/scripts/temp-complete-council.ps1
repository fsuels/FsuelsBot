$tasks = Get-Content 'C:\dev\FsuelsBot\workspace\memory\tasks.json' | ConvertFrom-Json

# Move T034 to done_today
$tasks.lanes.bot_current = @('T004')
$tasks.lanes.bot_queue = @()
$tasks.lanes.done_today += 'T034'

# Update T034 status
$tasks.tasks.T034.status = 'done'
$tasks.tasks.T034.completed = (Get-Date).ToString('o')
$tasks.tasks.T034.verified_by = 'Francisco'
$tasks.tasks.T034.notes = 'Verified by Francisco checking AI chat histories. Accountability protocol established. Lying consequence documented in SOUL.md.'

$tasks.version = $tasks.version + 1
$tasks.updated_at = (Get-Date).ToString('o')
$tasks | ConvertTo-Json -Depth 10 | Set-Content 'C:\dev\FsuelsBot\workspace\memory\tasks.json'
Write-Output 'T034 complete, T004 resumed'
