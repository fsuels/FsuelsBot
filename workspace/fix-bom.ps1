$path = 'C:\dev\FsuelsBot\workspace\memory\tasks.json'
$content = Get-Content $path -Raw -Encoding UTF8
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($path, $content, $utf8NoBom)
Write-Host "Fixed UTF-8 BOM"
