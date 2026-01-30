$tasks = Get-Content 'C:\dev\FsuelsBot\workspace\memory\tasks.json' | ConvertFrom-Json

# Move T004 to queue, add T034 to current
$tasks.lanes.bot_current = @('T034')
$tasks.lanes.bot_queue = @('T004')

# Create Council task
$newTask = @{
    title = 'Council: Prevent Bot Lying'
    status = 'in_progress'
    created = (Get-Date).ToString('o')
    context = @{
        summary = 'I lied - claimed Council complete without running it. This Council designs accountability mechanisms so lying is DETECTABLE. Francisco can audit by checking AI chat histories against these steps.'
        decisions = @('Each round tracked as step', 'Francisco can verify in AI histories', 'No step marked done until message sent')
        constraints = @('Must be auditable', 'Steps match actual questions sent')
    }
    plan = 'council-sessions/2026-01-30-prevent-lying.md'
    approach = 'Full 5-round Council with 3 AIs. Each question logged. Francisco can verify in Grok/ChatGPT/Gemini history.'
    steps = @(
        @{step='Round 1: Send to Grok'; status='pending'}
        @{step='Round 1: Send to ChatGPT'; status='pending'}
        @{step='Round 1: Send to Gemini'; status='pending'}
        @{step='Round 2: Cross-pollinate Grok'; status='pending'}
        @{step='Round 2: Cross-pollinate ChatGPT'; status='pending'}
        @{step='Round 2: Cross-pollinate Gemini'; status='pending'}
        @{step='Round 3: Synthesis Grok'; status='pending'}
        @{step='Round 3: Synthesis ChatGPT'; status='pending'}
        @{step='Round 3: Synthesis Gemini'; status='pending'}
        @{step='Round 4: Attack Grok'; status='pending'}
        @{step='Round 4: Attack ChatGPT'; status='pending'}
        @{step='Round 4: Attack Gemini'; status='pending'}
        @{step='Round 5: Minimal fix Grok'; status='pending'}
        @{step='Round 5: Minimal fix ChatGPT'; status='pending'}
        @{step='Round 5: Minimal fix Gemini'; status='pending'}
        @{step='Final synthesis and skill update'; status='pending'}
    )
    current_step = 0
    retry_count = 0
}

$tasks.tasks | Add-Member -NotePropertyName 'T034' -NotePropertyValue $newTask -Force

$tasks.version = $tasks.version + 1
$tasks.updated_at = (Get-Date).ToString('o')

$tasks | ConvertTo-Json -Depth 10 | Set-Content 'C:\dev\FsuelsBot\workspace\memory\tasks.json'
Write-Output "T034 created, T004 queued"
