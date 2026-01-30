# idle-guard.ps1 - Detect idle/suggestion patterns in bot responses
# Run during heartbeats or before sending responses

param(
    [string]$ResponseText = ""
)

$idlePatterns = @(
    "want me to",
    "would you like me to",
    "shall I",
    "should I",
    "let me know if",
    "I can do this if you",
    "waiting for your",
    "just let me know",
    "whenever you're ready"
)

$violations = @()

foreach ($pattern in $idlePatterns) {
    if ($ResponseText -match $pattern) {
        $violations += $pattern
    }
}

if ($violations.Count -gt 0) {
    Write-Host "⚠️ IDLE GUARD VIOLATION: Response contains suggestion patterns instead of action"
    Write-Host "Patterns found: $($violations -join ', ')"
    Write-Host ""
    Write-Host "RULE: If there's a task in bot_current, EXECUTE don't ASK."
    Write-Host "FIX: Rewrite response to show ACTION TAKEN, not permission requested."
    exit 1
}

Write-Host "✅ Response is action-oriented"
exit 0
