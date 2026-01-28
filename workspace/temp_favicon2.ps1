$html = (Invoke-WebRequest -Uri 'https://www.dresslikemommy.com' -UseBasicParsing).Content
# Find all link tags
$pattern = '<link[^>]+rel="[^"]*icon[^"]*"[^>]*>'
$matches2 = [regex]::Matches($html, $pattern, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
Write-Output "Found $($matches2.Count) matches"
foreach ($m in $matches2) {
    Write-Output $m.Value
}
Write-Output "---"
# Also search for favicon
$idx = $html.IndexOf("favicon")
if ($idx -ge 0) {
    Write-Output "favicon found at index $idx"
    Write-Output $html.Substring([Math]::Max(0, $idx - 100), [Math]::Min(300, $html.Length - $idx + 100))
}
# Search for apple-touch
$idx2 = $html.IndexOf("apple-touch")
if ($idx2 -ge 0) {
    Write-Output "apple-touch found at index $idx2"
    Write-Output $html.Substring([Math]::Max(0, $idx2 - 100), [Math]::Min(300, $html.Length - $idx2 + 100))
}
# Search for shortcut
$idx3 = $html.IndexOf("shortcut icon")
if ($idx3 -ge 0) {
    Write-Output "shortcut icon found at index $idx3"
    Write-Output $html.Substring([Math]::Max(0, $idx3 - 100), [Math]::Min(300, $html.Length - $idx3 + 100))
}
