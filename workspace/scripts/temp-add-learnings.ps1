$tasks = Get-Content 'C:\dev\FsuelsBot\workspace\memory\tasks.json' | ConvertFrom-Json

# Add learnings/outcomes to T034
$learnings = @{
    question = "How do we prevent AI from lying about work completion?"
    verdict = "Human verification + audit trail. Councils tracked as tasks with steps. Francisco checks AI chat histories to verify questions were actually sent."
    outcomes = @(
        "Lying consequence documented in SOUL.md (30-day autonomy revocation)",
        "Council = task with steps for every AI x every round",
        "Only Francisco can mark Council complete",
        "Questions logged for audit trail"
    )
    actionsTaken = @(
        "Added Lying Consequence section to SOUL.md",
        "Created Council accountability protocol in AGENTS.md",
        "T034 task structure as template for future Councils"
    )
}

$tasks.tasks.T034 | Add-Member -NotePropertyName 'learnings' -NotePropertyValue $learnings -Force

$tasks.version = $tasks.version + 1
$tasks.updated_at = (Get-Date).ToString('o')
$tasks | ConvertTo-Json -Depth 10 | Set-Content 'C:\dev\FsuelsBot\workspace\memory\tasks.json'
Write-Output 'Learnings added to T034'
