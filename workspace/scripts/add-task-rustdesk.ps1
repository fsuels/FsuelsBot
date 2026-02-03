$ErrorActionPreference = 'Stop'
$tasksPath = Join-Path $PSScriptRoot '..\memory\tasks.json'

# Read tasks.json tolerant of BOM
$raw = Get-Content $tasksPath -Raw -Encoding UTF8
if ($raw.Length -gt 0 -and $raw[0] -eq [char]0xFEFF) { $raw = $raw.Substring(1) }
$data = $raw | ConvertFrom-Json

# Find next T###
$taskIds = @($data.tasks.PSObject.Properties.Name)
$nums = $taskIds | Where-Object { $_ -match '^T\d+$' } | ForEach-Object { [int]$_.Substring(1) }
$max = if ($nums.Count -gt 0) { ($nums | Measure-Object -Maximum).Maximum } else { 0 }
$next = $max + 1
$tid = ('T{0:000}' -f $next)

$task = [ordered]@{
  title = 'Install RustDesk for full desktop control (open-source)'
  status = 'in_progress'
  created_at = (Get-Date).ToString('o')
  created_by = 'bot'
  instructions = 'Install RustDesk on DESKTOP-O6IL62J and configure for unattended access so Francisco can grant full desktop control. Start with safe defaults, require password, and document the connection procedure.'
  required_agent = 'code'
  steps = @(
    @{ step = 'Download RustDesk installer'; status = 'in_progress' },
    @{ step = 'Install RustDesk'; status = 'pending' },
    @{ step = 'Configure security (password, permissions)'; status = 'pending' },
    @{ step = 'Verify remote connection path + document'; status = 'pending' }
  )
  current_step = 0
  retry_count = 0
  context = @{ 
    summary = 'Francisco requested full desktop control comparable to TeamViewer. OpenClaw Windows desktop screen-node not available; RustDesk chosen as open-source solution.'
    decisions = @('Use RustDesk as open-source remote desktop')
    constraints = @('Security first: require password; no unattended access without explicit consent')
  }
  epistemic = @{
    claims = @()
    verified = @()
    unverified = @()
    confidence = 0.6
    verification_status = 'claimed'
    reasoning = @{
      premises = @('Need full desktop control')
      assumptions = @('RustDesk installer available for Windows')
      fallacy_check = 'Avoid overpromising full control until tested'
    }
  }
}

# Add task definition
$data.tasks | Add-Member -NotePropertyName $tid -NotePropertyValue $task

# Ensure lane exists
if (-not $data.lanes.bot_current) { $data.lanes.bot_current = @() }
$data.lanes.bot_current = @($tid) + @($data.lanes.bot_current | Where-Object { $_ -ne $tid })

$data.updated_at = (Get-Date).ToUniversalTime().ToString('o')
$data.updated_by = 'bot'
$data.version = [int]$data.version + 1

($data | ConvertTo-Json -Depth 50) | Set-Content -Path $tasksPath -Encoding UTF8
Write-Output $tid
