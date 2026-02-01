# Update T174 steps 4 and 5
$tasks = Get-Content 'C:\dev\FsuelsBot\workspace\memory\tasks.json' -Raw | ConvertFrom-Json

# Step 4 (outreach) needs human - mark waiting
$tasks.tasks.T174.steps[3].status = 'waiting'
$tasks.tasks.T174.steps[3] | Add-Member -NotePropertyName 'waiting_for' -NotePropertyValue 'Francisco to send DMs from @GhostBrokerAI' -Force
$tasks.tasks.T174.steps[3] | Add-Member -NotePropertyName 'artifacts' -NotePropertyValue @('ghost-broker/drafts/arena-2.0-outreach.md') -Force

# Step 5 (Moltbook) - drafts ready, needs posting
$tasks.tasks.T174.steps[4].status = 'waiting'
$tasks.tasks.T174.steps[4] | Add-Member -NotePropertyName 'waiting_for' -NotePropertyValue 'Human to post on Moltbook Discord' -Force
$tasks.tasks.T174.steps[4] | Add-Member -NotePropertyName 'artifacts' -NotePropertyValue @('ghost-broker/drafts/moltbook-arena-announcement.md') -Force

$tasks.tasks.T174.current_step = 3  # Stuck on step 4 (0-indexed = 3)
$tasks.version = $tasks.version + 1
$tasks.updated_at = (Get-Date).ToString('o')

$tasks | ConvertTo-Json -Depth 20 | Set-Content 'C:\dev\FsuelsBot\workspace\memory\tasks.json' -Encoding UTF8
Write-Host "T174 updated - steps 4+5 waiting for human action"
