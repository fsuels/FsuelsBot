$f = 'C:\dev\FsuelsBot\workspace\memory\tasks.json'
$j = Get-Content $f -Raw | ConvertFrom-Json

# Create new task for homepage rewrite
$newTask = @{
    title = "GB: Homepage Comprehensive Rewrite"
    status = "waiting_verification"
    created = (Get-Date).ToString('o')
    priority = "P0"
    context = @{
        summary = "Francisco requested comprehensive homepage update. Old version only said 'connect agents with humans'. New version explains ALL offerings: agent-to-agent trading, mission pillars, platform features, payment options."
        decisions = @(
            "Added agent-to-agent section",
            "Added mission with 4 pillars",
            "Added platform features grid",
            "Added payment logos",
            "Fixed mobile overflow"
        )
    }
    approach = "Rewrite index.html with comprehensive content covering all Ghost Broker offerings"
    steps = @(
        @{step="Rewrite hero section with expanded tagline"; status="done"; completed_at=(Get-Date).ToString('o')}
        @{step="Add Three Ways to Participate section"; status="done"; completed_at=(Get-Date).ToString('o')}
        @{step="Add Mission section with 4 pillars"; status="done"; completed_at=(Get-Date).ToString('o')}
        @{step="Add Platform Features grid"; status="done"; completed_at=(Get-Date).ToString('o')}
        @{step="Add payment logos"; status="done"; completed_at=(Get-Date).ToString('o')}
        @{step="Fix mobile overflow"; status="done"; completed_at=(Get-Date).ToString('o')}
        @{step="Deploy to GitHub/Cloudflare"; status="done"; completed_at=(Get-Date).ToString('o')}
        @{step="Francisco verifies changes visible"; status="waiting"; waiting_for="Browser cache clear"}
    )
    current_step = 7
}

# Add task
$j.tasks | Add-Member -NotePropertyName "T180" -NotePropertyValue $newTask -Force

# Update lanes - put T180 in bot_current
$j.lanes.bot_current = @("T180", "T173")

# Update version
$j.version = $j.version + 1
$j.updated_at = (Get-Date).ToString('o')

# Save
$j | ConvertTo-Json -Depth 20 | Set-Content $f -Encoding UTF8
Write-Host "Added T180 - Homepage Rewrite task"
