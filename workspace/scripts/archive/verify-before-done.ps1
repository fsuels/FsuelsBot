<#
.SYNOPSIS
    ENFORCEMENT: Blocks task completion without verification evidence
.DESCRIPTION
    Called before ANY task moves to done_today. Returns error if:
    - No epistemic.verification_status set
    - Status is "claimed" but claims[] is empty
    - Status is "evidence_provided" but verified[] is empty
    
    This is the GATE that prevents unverified completions.
#>

param(
    [Parameter(Mandatory=$true)]
    [string]$TaskId
)

$ErrorActionPreference = "Stop"
$WORKSPACE = "C:\dev\FsuelsBot\workspace"

# Load task
$tasks = Get-Content "$WORKSPACE\memory\tasks.json" -Raw | ConvertFrom-Json
$task = $tasks.tasks.$TaskId

if (-not $task) {
    Write-Error "BLOCKED: Task $TaskId not found"
    exit 1
}

# Check 1: Must have epistemic field
if (-not $task.epistemic) {
    Write-Error @"
BLOCKED: Task $TaskId has NO epistemic field.

Before marking complete, you MUST add:
{
    "epistemic": {
        "verification_status": "evidence_provided|claimed|human_verified",
        "claims": ["What you claim to have done"],
        "verified": ["Evidence that proves it"]
    }
}

THE MOTTO: EVERY task I complete → VERIFIED EVIDENCE
"@
    exit 1
}

# Check 2: Must have verification_status
if (-not $task.epistemic.verification_status) {
    Write-Error @"
BLOCKED: Task $TaskId has no verification_status.

Set one of:
- "human_verified" — Francisco confirmed
- "evidence_provided" — Proof exists
- "auto_verified" — Automated test passed
- "claimed" — No evidence (acceptable for minor tasks)
"@
    exit 1
}

# Check 3: If evidence_provided, must have verified[]
$status = $task.epistemic.verification_status
if ($status -eq "evidence_provided" -and (-not $task.epistemic.verified -or $task.epistemic.verified.Count -eq 0)) {
    Write-Error @"
BLOCKED: Task $TaskId claims evidence_provided but verified[] is empty.

You must list what evidence exists:
"verified": ["File X created", "Test Y passed", "Screenshot shows Z"]
"@
    exit 1
}

# Check 4: Must have at least one claim
if (-not $task.epistemic.claims -or $task.epistemic.claims.Count -eq 0) {
    Write-Error @"
BLOCKED: Task $TaskId has no claims[].

You must state what you're claiming to have done:
"claims": ["Did X", "Fixed Y", "Created Z"]
"@
    exit 1
}

# All checks passed
Write-Output "✅ VERIFIED: Task $TaskId passes epistemic gate"
Write-Output "   Status: $status"
Write-Output "   Claims: $($task.epistemic.claims.Count)"
Write-Output "   Evidence: $(if ($task.epistemic.verified) { $task.epistemic.verified.Count } else { 0 })"

exit 0
