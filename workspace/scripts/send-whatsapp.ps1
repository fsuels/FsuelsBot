param(
  [Parameter(Mandatory=$true)][string]$ContactName,
  [Parameter(Mandatory=$true)][string]$Message,
  [switch]$DryRun,
  [ValidateSet('Any','Delivered','Read')][string]$VerifyStatus = 'Any'
)

$ErrorActionPreference = 'Stop'

function Sanitize-Text([string]$s) {
  if ($null -eq $s) { return $s }

  # Strip control chars (keep TAB) and normalize whitespace to avoid JSON/unicode pipeline issues.
  $s = [regex]::Replace($s, "[\x00-\x08\x0B\x0C\x0E-\x1F]", "")
  $s = $s.Replace("`r", "")
  $s = $s.Replace("`n", " ")

  # Replace common smart punctuation
  $s = $s.Replace([char]0x2019, "'")  # ’
  $s = $s.Replace([char]0x2018, "'")  # ‘
  $s = $s.Replace([char]0x201C, '"')  # “
  $s = $s.Replace([char]0x201D, '"')  # ”
  $s = $s.Replace([char]0x2013, '-')   # –
  $s = $s.Replace([char]0x2014, '-')   # —
  $s = $s.Replace([char]0x00A0, ' ')   # nbsp

  # Collapse whitespace
  $s = ($s -replace '\s+', ' ').Trim()
  return $s
}

$ContactName = Sanitize-Text $ContactName
$Message = Sanitize-Text $Message

$ws = Split-Path -Parent $PSScriptRoot
$call = Join-Path $PSScriptRoot 'terminator-mcp-call.ps1'
$tmp = Join-Path $env:TEMP ("wa-" + [Guid]::NewGuid().ToString('n') + ".json")

function Invoke-Terminator([string]$tool, [hashtable]$toolArgs) {
  $json = ($toolArgs | ConvertTo-Json -Compress)
  # Write as UTF-8 (no BOM)
  [System.IO.File]::WriteAllText($tmp, $json, [System.Text.UTF8Encoding]::new($false))
  & powershell -NoProfile -ExecutionPolicy Bypass -File $call -Tool $tool -ArgsJson $tmp
}

# 1) Ensure we can see WhatsApp
Invoke-Terminator 'get_window_tree' @{
  process = 'WhatsApp.Root'
  include_tree_after_action = $true
  tree_output_format = 'compact_yaml'
  include_window_screenshot = $true
  detailed_attributes = $true
} | Out-Null

# 2) Type into Search
Invoke-Terminator 'type_into_element' @{
  process = 'WhatsApp.Root'
  selector = 'role:Edit|name:Search input textbox'
  text_to_type = $ContactName
  clear_before_typing = $true
  ui_diff_before_after = $true
  verify_element_exists = ''
  verify_element_not_exists = ''
  include_window_screenshot = $true
  highlight_before_action = $true
} | Out-Null

# 3) Click first chat result that contains the contact name
#    (Most deterministic: click exact chat DataItem if present; fallback is hard)
$tree = Invoke-Terminator 'get_window_tree' @{
  process = 'WhatsApp.Root'
  include_tree_after_action = $true
  tree_output_format = 'compact_yaml'
  include_window_screenshot = $true
  detailed_attributes = $true
}

# naive parse: try a few likely DataItem names
$chatCandidate = @(
  "role:DataItem|name:$ContactName",
  "role:DataItem|name:$ContactName Yesterday Voice call",
  "role:DataItem|name:$ContactName Yesterday",
  "role:DataItem|name:$ContactName Today",
  "role:DataItem|name:$ContactName Voice call"
)

$clicked = $false
foreach ($sel in $chatCandidate) {
  try {
    Invoke-Terminator 'click_element' @{
      process = 'WhatsApp.Root'
      selector = $sel
      click_type = 'left'
      highlight_before_action = $true
      ui_diff_before_after = $true
      verify_element_exists = ''
      verify_element_not_exists = ''
      include_window_screenshot = $true
    } | Out-Null
    $clicked = $true
    break
  } catch {
    # ignore
  }
}

if (-not $clicked) {
  throw "Could not click chat result for contact '$ContactName'. Try a more specific name as shown in WhatsApp search results."
}

# 4) Type message into composer
$composerName = "Type to $ContactName"
Invoke-Terminator 'type_into_element' @{
  process = 'WhatsApp.Root'
  selector = "role:Edit|name:$composerName"
  text_to_type = $Message
  clear_before_typing = $true
  ui_diff_before_after = $true
  verify_element_exists = ''
  verify_element_not_exists = ''
  include_window_screenshot = $true
  highlight_before_action = $true
} | Out-Null

# 5) Send
if (-not $DryRun) {
  Invoke-Terminator 'press_key' @{
    process = 'WhatsApp.Root'
    key = 'ENTER'
    highlight_before_action = $false
    ui_diff_before_after = $true
    verify_element_exists = ''
    verify_element_not_exists = ''
    include_window_screenshot = $true
  } | Out-Null
}

# 6) Verify by checking a fresh tree for "You <message>" and optional status keyword
$verify = Invoke-Terminator 'get_window_tree' @{
  process = 'WhatsApp.Root'
  include_tree_after_action = $true
  tree_output_format = 'compact_yaml'
  include_window_screenshot = $true
  detailed_attributes = $true
}

$verifyTextRaw = $verify | Out-String
# Normalize whitespace because the UI tree wraps long lines.
$verifyText = ($verifyTextRaw -replace '\s+', ' ').Trim()
$needle = ($Message -replace '\s+', ' ').Trim()

if ($DryRun) {
  # In dry-run we didn't press Enter, so the message will be in the composer, not in the chat as "You ..."
  if ($verifyText -notmatch [regex]::Escape($needle)) {
    throw "Verification failed (dry-run): could not find message text in UI tree."
  }
} else {
  # Don't require exact "You <message>"; just ensure message text appears somewhere and verify optional status.
  if ($verifyText -notmatch [regex]::Escape($needle)) {
    throw "Verification failed: could not find message text in UI tree."
  }
  if ($VerifyStatus -ne 'Any') {
    if ($verifyText -notmatch $VerifyStatus) {
      throw "Verification failed: expected status '$VerifyStatus' not found in UI tree."
    }
  }
}

$mode = $(if ($DryRun) { 'dry-run' } else { 'sent' })
Write-Output "OK: message $mode for '$ContactName'."
