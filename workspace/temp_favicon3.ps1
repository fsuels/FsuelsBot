$html = (Invoke-WebRequest -Uri 'https://www.dresslikemommy.com' -UseBasicParsing).Content
# Search for any link with rel containing icon
$lines = $html -split "`n"
foreach ($line in $lines) {
    if ($line -match 'rel=.*icon' -or $line -match 'favicon') {
        Write-Output $line.Trim()
    }
}
Write-Output "--- Checking for CDN images ---"
$pattern2 = 'https://cdn\.shopify\.com/s/files/[^"'']+\.(png|ico|svg)'
$matches3 = [regex]::Matches($html, $pattern2)
Write-Output "Found $($matches3.Count) CDN image URLs"
foreach ($m in $matches3) {
    Write-Output $m.Value
}
