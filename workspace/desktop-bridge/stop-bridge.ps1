$ErrorActionPreference = 'SilentlyContinue'
Get-Process python -ErrorAction SilentlyContinue | Where-Object {
  try {
    $_.Path -and ($_.Path -like '*python.exe')
  } catch { $false }
} | ForEach-Object {
  # best-effort: kill python processes running server.py by command line (wmic fallback)
}
# Prefer killing by window title not available; use netstat to find PID on 18888
$line = (netstat -ano | Select-String ':18888').ToString()
if ($line) {
  $pid = ($line -split '\s+')[-1]
  if ($pid -match '^\d+$') { Stop-Process -Id [int]$pid -Force -ErrorAction SilentlyContinue; Write-Host "Stopped PID $pid"; exit 0 }
}
Write-Host "No bridge process found on port 18888"
