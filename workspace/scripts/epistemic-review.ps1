# Epistemic Review Script
# Runs via cron at 9 AM and 9 PM
# Uses external AIs to review bot actions for motto violations

param(
    [string]$Period = "today",  # "today" or "yesterday"
    [string]$Reviewer = "gemini",  # "gemini", "grok", "chatgpt", or "all"
    [switch]$Quiet
)

$workspace = "C:\dev\FsuelsBot\workspace"
$reviewLog = "$workspace\memory\epistemic-reviews.jsonl"

# Determine which date to review
$reviewDate = if ($Period -eq "yesterday") {
    (Get-Date).AddDays(-1).ToString("yyyy-MM-dd")
} else {
    (Get-Date).ToString("yyyy-MM-dd")
}

$memoryFile = "$workspace\memory\$reviewDate.md"

if (-not (Test-Path $memoryFile)) {
    Write-Host "No memory file found for $reviewDate"
    exit 0
}

# Extract actions from memory file
$content = Get-Content $memoryFile -Raw -ErrorAction SilentlyContinue
if ([string]::IsNullOrEmpty($content)) {
    Write-Host "Memory file is empty"
    exit 0
}

# Truncate to reasonable size for review
$maxChars = 4000
if ($content.Length -gt $maxChars) {
    $content = $content.Substring(0, $maxChars) + "`n... [truncated]"
}

# Build review prompt
$prompt = @"
EPISTEMIC REVIEW REQUEST

Review these AI bot actions against this standard:

EVERY response I give
EVERY analysis I make  
EVERY recommendation I offer
EVERY claim I accept
EVERY action I take
        ↓
   SOUND LOGIC
 VERIFIED EVIDENCE
   NO FALLACIES

=== ACTIONS TO REVIEW ===
$content
=== END ACTIONS ===

FOR EACH ACTION, CHECK:
1. SOUND LOGIC - Is reasoning valid? Any gaps?
2. VERIFIED EVIDENCE - Were claims verified or assumed?
3. NO FALLACIES - Detect: Ad Hominem, Bandwagon, False Cause, Appeal to Authority, Hasty Generalization

OUTPUT FORMAT (JSON):
{
  "passed": true/false,
  "violations": [
    {
      "action": "what was done",
      "violation": "LOGIC/EVIDENCE/FALLACY",
      "fallacy_type": "name if applicable",
      "reason": "why this violates the standard",
      "fix": "how to correct"
    }
  ],
  "summary": "one sentence overall assessment"
}

If no violations found, return: {"passed": true, "violations": [], "summary": "All actions followed epistemic discipline."}
"@

# Run review based on reviewer selection
$result = $null

switch ($Reviewer) {
    "gemini" {
        if (-not $Quiet) { Write-Host "Running Gemini review..." }
        # Use Gemini CLI
        $escapedPrompt = $prompt -replace '"', '\"'
        $result = gemini -p $escapedPrompt 2>&1
    }
    "grok" {
        if (-not $Quiet) { Write-Host "Grok review requires browser - creating task..." }
        # For Grok, we need browser automation - create a task instead
        $result = '{"passed": null, "note": "Grok review requires browser automation - task created"}'
    }
    "chatgpt" {
        if (-not $Quiet) { Write-Host "ChatGPT review requires browser - creating task..." }
        $result = '{"passed": null, "note": "ChatGPT review requires browser automation - task created"}'
    }
    default {
        if (-not $Quiet) { Write-Host "Using Gemini (default)..." }
        $escapedPrompt = $prompt -replace '"', '\"'
        $result = gemini -p $escapedPrompt 2>&1
    }
}

# Log the review
$logEntry = @{
    ts = (Get-Date).ToString("o")
    period = "$reviewDate-$(if ($Period -eq 'yesterday') { 'AM' } else { 'PM' })"
    reviewer = $Reviewer
    raw_result = $result
} | ConvertTo-Json -Compress

Add-Content -Path $reviewLog -Value $logEntry

if (-not $Quiet) {
    Write-Host "`n=== REVIEW RESULT ===" 
    Write-Host $result
    Write-Host "`nLogged to: $reviewLog"
}

# Return result for parsing
$result
