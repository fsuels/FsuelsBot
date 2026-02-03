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
  title = 'Desktop control for OpenClaw: desktop-bridge + integration (eyes+hands)'
  status = 'in_progress'
  created_at = (Get-Date).ToString('o')
  created_by = 'bot'
  instructions = 'Create a purpose-built local desktop control bridge (screenshot + input) and integrate it so the agent can drive the Windows desktop safely.'
  required_agent = 'code'
  steps = @(
    @{ step = 'Ship desktop-bridge MVP (local-only, token)'; status = 'in_progress' },
    @{ step = 'Add start/stop scripts + optional Scheduled Task'; status = 'pending' },
    @{ step = 'Integrate into Mission Control / agent workflow'; status = 'pending' },
    @{ step = 'Verify: screenshot capture + a safe click/type demo'; status = 'pending' }
  )
  current_step = 0
  retry_count = 0
  context = @{ 
    summary = 'Francisco requires the assistant to control the full Windows desktop. RustDesk enables human remote access but does not provide agent control. We will build an open-source local bridge that exposes screenshot + input APIs with strong safety gates.'
    decisions = @('Local-only binding', 'Token auth', 'Control disabled by default')
    constraints = @('No paid services', 'Safety gates required', 'Must be verifiable')
  }
  epistemic = @{
    claims = @()
    verified = @()
    unverified = @()
    confidence = 0.55
    verification_status = 'claimed'
    reasoning = @{
      premises = @('Agent needs eyes+hands to drive desktop', 'Remote desktop apps are human-focused')
      assumptions = @('We can capture screenshots and send input events locally')
      fallacy_check = 'Avoid overpromising full autonomy until vision loop is validated'
    }
  }
}

$data.tasks | Add-Member -NotePropertyName $tid -NotePropertyValue $task

if (-not $data.lanes.bot_current) { $data.lanes.bot_current = @() }
$data.lanes.bot_current = @($tid) + @($data.lanes.bot_current | Where-Object { $_ -ne $tid })

$data.updated_at = (Get-Date).ToUniversalTime().ToString('o')
$data.updated_by = 'bot'
$data.version = [int]$data.version + 1

($data | ConvertTo-Json -Depth 50) | Set-Content -Path $tasksPath -Encoding UTF8
Write-Output $tid
