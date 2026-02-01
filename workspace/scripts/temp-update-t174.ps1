$tasks = Get-Content 'C:\dev\FsuelsBot\workspace\memory\tasks.json' -Raw | ConvertFrom-Json
$tasks.tasks.T174.steps[2].status = 'done'
$tasks.tasks.T174.steps[2].completed_at = (Get-Date).ToString('o')
$tasks.tasks.T174.steps[2] | Add-Member -NotePropertyName 'artifacts' -NotePropertyValue @('ghost-broker/website/images/arena-2-infographic.png') -Force
$tasks.tasks.T174.current_step = 3
$tasks.version = $tasks.version + 1
$tasks.updated_at = (Get-Date).ToString('o')
$tasks | ConvertTo-Json -Depth 20 | Set-Content 'C:\dev\FsuelsBot\workspace\memory\tasks.json' -Encoding UTF8
Write-Host "T174 step 3 marked complete"
