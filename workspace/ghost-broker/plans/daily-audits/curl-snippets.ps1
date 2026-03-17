$c = (& curl.exe -sS https://ghostbrokerai.xyz/robots.txt | Out-String)
$c.Substring(0, [Math]::Min(300, $c.Length))

"---"

$s = (& curl.exe -sS https://ghostbrokerai.xyz/sitemap.xml | Out-String)
$s.Substring(0, [Math]::Min(300, $s.Length))
