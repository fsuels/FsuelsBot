$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$py = (Get-Command python).Source
Write-Host "Using python: $py"
Start-Process -FilePath $py -ArgumentList "`"$PSScriptRoot\server.py`"" -WindowStyle Hidden
Write-Host "Started desktop-bridge (check http://127.0.0.1:18888/health)"
