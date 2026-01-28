$html = (Invoke-WebRequest -Uri 'https://www.dresslikemommy.com' -UseBasicParsing).Content
$pattern = '<link[^>]*(icon|shortcut|apple-touch)[^>]*>'
$matches2 = [regex]::Matches($html, $pattern)
foreach ($m in $matches2) {
    Write-Output $m.Value
}
