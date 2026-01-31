$event = @{
    ts = (Get-Date).ToString('o')
    id = 'EVT-20260130-015'
    type = 'state_checkpoint'
    priority = 'P1'
    content = 'Pre-compaction: T059 Brand Protection in progress. GhostBrokerAI registered on X (@GhostBrokerAI) and Moltbook (verified). GitHub org form filled waiting for human CAPTCHA. Pending: Instagram, TikTok, LinkedIn, YouTube, ENS, domains.'
    tags = @('compaction','checkpoint','brand-protection')
    session = 'main'
}
$json = $event | ConvertTo-Json -Compress
Add-Content -Path 'memory/events.jsonl' -Value $json
Write-Host "Event appended"
