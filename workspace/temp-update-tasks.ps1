$f = 'C:\dev\FsuelsBot\workspace\memory\tasks.json'
$j = Get-Content $f -Raw | ConvertFrom-Json

# Move T179 from bot_current to done_today
$j.lanes.bot_current = @($j.lanes.bot_current | Where-Object { $_ -ne 'T179' })
if ($j.lanes.done_today -notcontains 'T179') {
    $j.lanes.done_today = @('T179') + $j.lanes.done_today
}

# Update T179 status
$j.tasks.T179.status = 'done'

# Update metadata
$j.version = $j.version + 1
$j.updated_at = (Get-Date).ToString('o')

# Save
$j | ConvertTo-Json -Depth 20 | Set-Content $f -Encoding UTF8
Write-Host "Updated tasks.json - T179 moved to done_today"
