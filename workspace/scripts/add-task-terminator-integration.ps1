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
  title = 'Integrate Terminator MCP desktop automation into OpenClaw workflow'
  status = 'in_progress'
  created_at = (Get-Date).ToString('o')
  created_by = 'bot'
  instructions = 'Create a thin local wrapper so OpenClaw can send MCP requests to terminator-mcp-agent and receive tool results (screenshots/find/click/type). Then verify with a safe demo.'
  required_agent = 'code'
  steps = @(
    @{ step = 'Verify terminator-mcp-agent runs and list tools'; status = 'in_progress' },
    @{ step = 'Implement wrapper (stdio MCP client)'; status = 'pending' },
    @{ step = 'Expose wrapper to agent (local HTTP or tool)'; status = 'pending' },
    @{ step = 'Verify: screenshot + click/type demo'; status = 'pending' }
  )
  current_step = 0
  retry_count = 0
  context = @{ 
    summary = 'Francisco installed Terminator MCP Agent (desktop automation). We need to integrate it into OpenClaw so the agent can actually drive Windows apps, not just a human using RustDesk.'
    decisions = @('Prefer Terminator MCP over custom bridge if stable', 'Local-only wrapper')
    constraints = @('No paid services', 'Must be verifiable and safe')
  }
  epistemic = @{
    claims = @('terminator-mcp-agent runs from npx on this machine')
    verified = @('npx reported Terminator MCP Agent v0.24.28 and started server successfully')
    unverified = @('OpenClaw can dispatch MCP tool calls without wrapper')
    confidence = 0.55
    verification_status = 'claimed'
    reasoning = @{
      premises = @('We need programmatic desktop automation', 'Terminator provides MCP tool surface')
      assumptions = @('We can implement a small MCP stdio client wrapper')
      fallacy_check = 'Avoid assuming MCP integration exists; we will build wrapper and verify'
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
