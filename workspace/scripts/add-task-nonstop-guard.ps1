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
  title = 'Non-stop guard: detect idle/stall + auto-alert + auto-resume when bot_current non-empty'
  status = 'in_progress'
  created_at = (Get-Date).ToString('o')
  created_by = 'bot'
  required_agent = 'code'
  instructions = 'Add a watchdog that prevents silent idle when bot_current has tasks: (1) detect no new activity for N minutes, (2) send Telegram alert with current blockers + last evidence, (3) auto-run a safe recovery action (restart mission-control, ensure Terminator server up), (4) write a progress heartbeat into tasks.json.'
  steps = @(
    @{ step = 'Create watchdog script + cron schedule'; status = 'in_progress' },
    @{ step = 'Integrate with Mission Control activity + evidence snapshot'; status = 'pending' },
    @{ step = 'Verify by forcing a simulated stall and observing alert'; status = 'pending' }
  )
  current_step = 0
  retry_count = 0
  context = @{ 
    summary = 'Francisco reported the bot went idle for hours despite instructions to keep working. We will add an enforced anti-idle guard that alerts and attempts recovery automatically.'
    decisions = @('Prefer detection+alert over pretending progress', 'Auto-recover only safe actions')
    constraints = @('No paid services', 'No external messaging beyond Telegram alert')
  }
  epistemic = @{
    claims = @('We can detect silent idle by checking last tool/run evidence timestamps')
    verified = @()
    unverified = @()
    confidence = 0.6
    verification_status = 'claimed'
    reasoning = @{
      premises = @('Silent idle breaks trust and delays revenue work')
      assumptions = @('We can read last activity from local logs/artifacts reliably')
      fallacy_check = 'Avoid assuming cause; focus on robust detection and recovery'
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
