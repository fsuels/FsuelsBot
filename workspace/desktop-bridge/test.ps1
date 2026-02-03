$t = (Get-Content "C:\dev\FsuelsBot\workspace\memory\.desktop-bridge-token" -Raw).Trim()
$r = Invoke-RestMethod -Uri "http://127.0.0.1:18888/health" -Headers @{ "X-Desktop-Token" = $t }
$r | ConvertTo-Json -Compress
