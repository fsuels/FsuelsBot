$tasks = Get-Content 'C:\dev\FsuelsBot\workspace\memory\tasks.json' -Raw | ConvertFrom-Json

# Move T178 from human to done_today
$humanList = [System.Collections.ArrayList]@($tasks.lanes.human)
$humanList.Remove('T178')
$tasks.lanes.human = $humanList

$doneList = [System.Collections.ArrayList]@($tasks.lanes.done_today)
if (-not $doneList.Contains('T178')) {
    $doneList.Insert(0, 'T178')
}
$tasks.lanes.done_today = $doneList

# Update task status
$tasks.tasks.T178.status = 'done'
$tasks.tasks.T178 | Add-Member -NotePropertyName 'completed' -NotePropertyValue (Get-Date).ToString('o') -Force
$tasks.tasks.T178.notes = 'DNS setup complete. ghostbrokerai.xyz and www.ghostbrokerai.xyz both point to ghost-broker.pages.dev via Cloudflare CNAME records. SSL automatic via Cloudflare. Site is LIVE!'

$tasks.version++
$tasks.updated_at = (Get-Date).ToString('o')

$tasks | ConvertTo-Json -Depth 20 | Set-Content 'C:\dev\FsuelsBot\workspace\memory\tasks.json' -Encoding UTF8
Write-Host "T178 marked complete"
