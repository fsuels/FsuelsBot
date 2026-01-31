$event = @{
    ts = (Get-Date).ToString('o')
    id = 'EVT-20260131-FLUSH'
    type = 'state_checkpoint'
    priority = 'P0'
    content = 'Pre-compaction flush. T173 homepage rewrite deployed to ghostbrokerai.xyz. Added: agent-to-agent section, mission pillars (Discovery/Trust/Collaboration/Settlement), platform features grid, payment logos (Stripe/PayPal/USDC/ETH), mobile overflow fix. Francisco browser cache issue - instructed hard refresh. T179 marketplace research completed.'
    tags = @('compaction','checkpoint','ghost-broker')
}
$json = $event | ConvertTo-Json -Compress
Add-Content -Path 'C:\dev\FsuelsBot\workspace\memory\events.jsonl' -Value $json
Write-Host "Event appended"
