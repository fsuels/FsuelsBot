$html = (Invoke-WebRequest -Uri 'https://www.dresslikemommy.com' -UseBasicParsing).Content
# Search for logo images
$pattern = 'src="[^"]*logo[^"]*"'
$matches2 = [regex]::Matches($html, $pattern, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
Write-Output "Logo matches: $($matches2.Count)"
foreach ($m in $matches2) {
    Write-Output $m.Value
}
Write-Output "---"
# Search for header image / brand image
$pattern2 = 'class="header__heading-logo[^"]*"[^>]*src="([^"]*)"'
$matches3 = [regex]::Matches($html, $pattern2, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
Write-Output "Header logo matches: $($matches3.Count)"
foreach ($m in $matches3) {
    Write-Output $m.Value
}
# Also search for any img tags near "header" or "brand"
$pattern3 = 'header__heading[^>]*>[\s\S]*?src="([^"]*)"'
$matches4 = [regex]::Matches($html, $pattern3, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
Write-Output "Header img matches: $($matches4.Count)"
foreach ($m in $matches4) {
    Write-Output $m.Groups[1].Value
}
