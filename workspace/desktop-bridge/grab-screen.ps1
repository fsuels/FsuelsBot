$t = (Get-Content "C:\dev\FsuelsBot\workspace\memory\.desktop-bridge-token" -Raw).Trim()
Invoke-WebRequest -Uri "http://127.0.0.1:18888/screen.png" -Headers @{ "X-Desktop-Token" = $t } -OutFile "C:\dev\FsuelsBot\workspace\desktop-bridge\screen.png"
Write-Output "ok"
