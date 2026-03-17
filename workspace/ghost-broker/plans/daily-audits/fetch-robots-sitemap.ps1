$u1 = 'https://ghostbrokerai.xyz/robots.txt'
$u2 = 'https://ghostbrokerai.xyz/sitemap.xml'

function Fetch([string]$u) {
  $r = Invoke-WebRequest -Uri $u -Method Get -Headers @{ 'Cache-Control' = 'no-cache' } -MaximumRedirection 5 -ErrorAction Stop
  $c = $r.Content
  if ($null -eq $c) { $c = '' }
  $first = $c.Substring(0, [Math]::Min(200, $c.Length))
  [pscustomobject]@{
    url         = $u
    status      = $r.StatusCode
    contentType = $r.Headers['Content-Type']
    server      = $r.Headers['Server']
    cfRay       = $r.Headers['CF-RAY']
    len         = $r.RawContentLength
    first200    = $first
  }
}

@(
  Fetch $u1
  Fetch $u2
) | ConvertTo-Json -Depth 4
