$t = (Get-Content "C:\dev\FsuelsBot\workspace\memory\.desktop-bridge-token" -Raw).Trim()
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:18888/control/enable" -Headers @{ "X-Desktop-Token" = $t } | ConvertTo-Json -Compress
