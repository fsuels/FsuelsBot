$tasks = Get-Content 'memory/tasks.json' -Raw | ConvertFrom-Json

# Create T059 - Brand Protection
$t059 = @{
    title = "Secure GhostBrokerAI on ALL platforms - Brand Protection"
    status = "in_progress"
    created = (Get-Date).ToString('o')
    context = @{
        summary = "Protect GhostBrokerAI brand by securing the name on all major platforms before someone else takes it"
        decisions = @(
            "Same name everywhere: GhostBrokerAI",
            "Include crypto/payment platforms",
            "Move FAST"
        )
    }
    steps = @(
        @{step = "GitHub - create account"; status = "pending"},
        @{step = "Discord - create server"; status = "pending"},
        @{step = "LinkedIn - create page"; status = "pending"},
        @{step = "Instagram - create account"; status = "pending"},
        @{step = "TikTok - create account"; status = "pending"},
        @{step = "YouTube - create channel"; status = "pending"},
        @{step = "Threads - create account"; status = "pending"},
        @{step = "BlueSky - create account"; status = "pending"},
        @{step = "ENS domain - ghostbrokerai.eth"; status = "pending"},
        @{step = "Unstoppable Domains - ghostbrokerai"; status = "pending"},
        @{step = "Domain - ghostbrokerai.com"; status = "pending"}
    )
    current_step = 0
    retry_count = 0
}

$tasks.tasks | Add-Member -NotePropertyName "T059" -NotePropertyValue $t059 -Force
$tasks.lanes.bot_current += "T059"
$tasks.version = $tasks.version + 1
$tasks.updated_at = (Get-Date).ToString('o')

$tasks | ConvertTo-Json -Depth 20 | Set-Content 'memory/tasks.json'
Write-Host "T059 created - Brand Protection"
