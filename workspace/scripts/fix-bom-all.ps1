$utf8NoBom = New-Object System.Text.UTF8Encoding $false

# Fix tasks.json
$tasksPath = 'C:\dev\FsuelsBot\workspace\memory\tasks.json'
$content = Get-Content $tasksPath -Raw -Encoding UTF8
[System.IO.File]::WriteAllText($tasksPath, $content, $utf8NoBom)
Write-Host "Fixed tasks.json"

# Fix state.json
$statePath = 'C:\dev\FsuelsBot\workspace\memory\state.json'
$content = Get-Content $statePath -Raw -Encoding UTF8
[System.IO.File]::WriteAllText($statePath, $content, $utf8NoBom)
Write-Host "Fixed state.json"

Write-Host "All BOMs removed"
