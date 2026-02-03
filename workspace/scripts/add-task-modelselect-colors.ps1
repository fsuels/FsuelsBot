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
  title = 'Mission Control: fix model dropdown readability (colors)'
  status = 'in_progress'
  created_at = (Get-Date).ToString('o')
  created_by = 'bot'
  instructions = 'Improve the model selector dropdown (modelSelect) styling so options are readable on dark theme (fix washed-out/light text on light dropdown background).'
  required_agent = 'code'
  steps = @(
    @{ step = 'Add CSS for select/options (dark scheme)'; status = 'in_progress' },
    @{ step = 'Verify visually in Mission Control (screenshot)'; status = 'pending' }
  )
  current_step = 0
  retry_count = 0
  context = @{ 
    summary = 'Francisco reported the model dropdown options are hard to read due to low contrast. We will enforce dark dropdown option backgrounds and readable text.'
    decisions = @('Use CSS option styling and color-scheme: dark')
    constraints = @('Must remain readable across Chromium/Edge; avoid breaking layout')
  }
  epistemic = @{
    claims = @()
    verified = @()
    unverified = @()
    confidence = 0.75
    verification_status = 'claimed'
    reasoning = @{
      premises = @('Low contrast reduces usability')
      assumptions = @('Chromium will respect option styling and/or color-scheme')
      fallacy_check = 'Avoid assuming all browsers style <option>; verify on your machine'
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
