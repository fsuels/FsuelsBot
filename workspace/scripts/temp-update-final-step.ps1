$tasks = Get-Content 'C:\dev\FsuelsBot\workspace\memory\tasks.json' | ConvertFrom-Json

# Update final step to be Francisco's verification
$tasks.tasks.T034.steps[15] = @{
    step = 'Francisco verifies in AI histories'
    status = 'waiting'
    waiting_for = 'Francisco checks Grok/ChatGPT/Gemini chat histories to confirm questions were actually sent'
}

$tasks.version = $tasks.version + 1
$tasks.updated_at = (Get-Date).ToString('o')
$tasks | ConvertTo-Json -Depth 10 | Set-Content 'C:\dev\FsuelsBot\workspace\memory\tasks.json'
Write-Output 'Updated - final step is Francisco verification'
