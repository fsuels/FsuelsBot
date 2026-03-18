# Fetch competitor landing pages for daily audit.
# Epistemic rule: if fetch fails, competitor snapshot is UNVERIFIED. Do not infer anything from the failure.

$urls = @(
  'https://agent.ai',
  'https://clawhub.ai',
  'https://hired.works'
)

function Fetch([string]$u) {
  try {
    $r = Invoke-WebRequest -Uri $u -Method Get -Headers @{ 'Cache-Control' = 'no-cache' } -MaximumRedirection 5 -TimeoutSec 30 -ErrorAction Stop
    $c = $r.Content
    if ($null -eq $c) { $c = '' }
    $first = $c.Substring(0, [Math]::Min(300, $c.Length))

    return [pscustomobject]@{
      url         = $u
      ok          = $true
      status      = $r.StatusCode
      contentType = $r.Headers['Content-Type']
      server      = $r.Headers['Server']
      len         = $r.RawContentLength
      first300    = $first
      error       = $null
    }
  }
  catch {
    return [pscustomobject]@{
      url         = $u
      ok          = $false
      status      = $null
      contentType = $null
      server      = $null
      len         = $null
      first300    = $null
      error       = $_.Exception.Message
    }
  }
}

$urls | ForEach-Object { Fetch $_ } | ConvertTo-Json -Depth 4
