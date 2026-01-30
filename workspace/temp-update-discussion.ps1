$tasks = Get-Content 'memory/tasks.json' -Raw | ConvertFrom-Json

# Add comment to T057
$comment57 = @{
    ts = (Get-Date).ToString('o')
    author = 'bot'
    message = 'Got it! GhostBrokerAI is already registered on Moltbook (credentials in memory/ghostbrokerai-credentials.json). You have @GhostBrokerAI on X. Just need to claim: visit https://moltbook.com/claim/moltbook_claim_jUGCyz1X1S1MrraaE8v4yHUXk7baGp8s and post the verification tweet with code: rocky-CG5B'
}
$tasks.tasks.T057.discussion += $comment57
$tasks.tasks.T057.title = 'Register GhostBrokerAI on Moltbook'

# Add comment to T058
$comment58 = @{
    ts = (Get-Date).ToString('o')
    author = 'bot'
    message = 'Verified! You have @GhostBrokerAI on X. GhostBrokerAI is registered on Moltbook. Once you claim it (rocky-CG5B), we can start the Ghost Broker marketplace.'
}
$tasks.tasks.T058.discussion += $comment58

$tasks | ConvertTo-Json -Depth 20 | Set-Content 'memory/tasks.json'
Write-Host "Updated"
