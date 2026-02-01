$tasks = Get-Content 'C:\dev\FsuelsBot\workspace\memory\tasks.json' -Raw | ConvertFrom-Json

# Create new task T190 for X researcher outreach
$newTask = @{
    title = "GB: X Researcher Engagement Campaign"
    status = "in_progress"
    created = (Get-Date).ToString('o')
    priority = "P1"
    context = @{
        summary = "Francisco shared @ProfBuehlerMIT tweet about AI swarms. Research popular AI researchers on X, find relevant posts about multi-agent AI, and reply from @GhostBrokerAI to promote Arena 2.0. Targets: Karpathy (1.6M followers, posted about @moltbook), Jim Fan (352K, multi-agent sims), Buehler (MIT, AI swarms)."
        decisions = @(
            "Focus on researchers discussing multi-agent AI",
            "Reply with Arena 2.0 value prop",
            "Ride the @moltbook wave"
        )
        constraints = @(
            "Don't spam",
            "Be genuine and add value",
            "Connect to Arena 2.0 thesis"
        )
    }
    approach = "Research top AI researchers on X, read recent posts, draft and post replies connecting their work to Arena 2.0"
    steps = @(
        @{step = "Research AI researchers on X"; status = "done"; completed_at = (Get-Date).ToString('o')}
        @{step = "Found Karpathy @moltbook post (12.8M views)"; status = "done"; completed_at = (Get-Date).ToString('o')}
        @{step = "Found Jim Fan multi-agent post (94K views)"; status = "done"; completed_at = (Get-Date).ToString('o')}
        @{step = "Found Buehler protein swarm post (15.7K views)"; status = "done"; completed_at = (Get-Date).ToString('o')}
        @{step = "Draft replies for all three posts"; status = "done"; completed_at = (Get-Date).ToString('o')}
        @{step = "Post replies from @GhostBrokerAI"; status = "pending"; waiting_for = "Francisco approval"}
    )
    current_step = 5
    retry_count = 0
}

$tasks.tasks | Add-Member -NotePropertyName "T190" -NotePropertyValue $newTask -Force

# Add to bot_current
$tasks.lanes.bot_current = @("T190") + $tasks.lanes.bot_current

$tasks.version = $tasks.version + 1
$tasks.updated_at = (Get-Date).ToString('o')

$tasks | ConvertTo-Json -Depth 20 | Set-Content 'C:\dev\FsuelsBot\workspace\memory\tasks.json' -Encoding UTF8
Write-Host "T190 created and added to bot_current"
