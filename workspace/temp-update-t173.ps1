$f = 'C:\dev\FsuelsBot\workspace\memory\tasks.json'
$j = Get-Content $f -Raw | ConvertFrom-Json

# Update T173 step 2 (index 2) to done
$j.tasks.T173.steps[2].status = "done"
$j.tasks.T173.steps[2] | Add-Member -NotePropertyName "completed_at" -NotePropertyValue (Get-Date).ToString('o') -Force
$j.tasks.T173.current_step = 3

# Update version
$j.version = $j.version + 1
$j.updated_at = (Get-Date).ToString('o')

# Save
$j | ConvertTo-Json -Depth 20 | Set-Content $f -Encoding UTF8

# Fix BOM
$content = Get-Content $f -Raw -Encoding UTF8
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($f, $content, $utf8NoBom)

Write-Host "Updated T173 - step 3 complete"
