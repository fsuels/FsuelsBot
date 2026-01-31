$event = @{
    ts = (Get-Date).ToString('o')
    id = 'EVT-20260130-016'
    type = 'state_checkpoint'
    priority = 'P1'
    content = 'Pre-compaction: T059 Brand Protection. X + Moltbook DONE. Images generated (avatar + banner). Gmail pending phone verification (Francisco scanned QR). GitHub needs CAPTCHA. Instagram/TikTok blocked on Gmail.'
    tags = @('compaction','checkpoint','brand-protection','images')
    session = 'main'
}
$json = $event | ConvertTo-Json -Compress
Add-Content -Path 'memory/events.jsonl' -Value $json
Write-Host "Event appended"
