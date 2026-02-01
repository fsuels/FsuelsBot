$event = @{
    ts = (Get-Date).ToString('o')
    id = 'EVT-20260131-STATE'
    type = 'state_checkpoint'
    priority = 'P0'
    content = 'Pre-compaction checkpoint. T174 Arena Promotion: Step 3 done (infographic), Steps 4-5 waiting human (DM outreach + Moltbook post). T180 waiting verification. Artifacts: arena-2-infographic.png, outreach.md, moltbook-announcement.md'
    session = 'main'
}
$json = $event | ConvertTo-Json -Compress
Add-Content -Path 'C:\dev\FsuelsBot\workspace\memory\events.jsonl' -Value $json -Encoding UTF8
Write-Host "Event appended"
