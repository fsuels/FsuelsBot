$filePath = 'C:\dev\FsuelsBot\workspace\memory\tasks.json'
$content = Get-Content $filePath -Raw -Encoding UTF8
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($filePath, $content, $utf8NoBom)
Write-Host "BOM removed from tasks.json"
