---
updated: 2026-01-31
version: "1.0"
confidence: high
type: procedure
---

# Task Completion Procedure

> **Trigger:** Before marking ANY task as done
> **Rule:** No task moves to done_today without passing the verification gate
> **Created:** 2026-01-31 (after finding 114 unverified completions)

## 🧭 THE MOTTO (Applies to EVERY completion)

```
EVERY task I complete
        ↓
   VERIFIED EVIDENCE
```

---

## VERIFICATION GATE (MANDATORY)

Before marking a task complete, you MUST:

### Step 1: List Your Claims
What are you claiming to have done?
```json
"epistemic": {
    "claims": [
        "Created file X",
        "Fixed bug Y",
        "Tested scenario Z"
    ]
}
```

### Step 2: Provide Evidence
How can this be verified?
```json
"epistemic": {
    "verified": [
        "File X exists at path/to/file.md",
        "Test output shows: [result]",
        "Screenshot saved to: [location]"
    ]
}
```

### Step 3: Set Verification Status
Choose honestly:
- `human_verified` — Francisco confirmed it works
- `evidence_provided` — Proof exists (file, test, screenshot)
- `auto_verified` — Automated test passed
- `claimed` — No evidence (acceptable ONLY for trivial tasks)

### Step 4: Run Verification Script
```powershell
powershell -ExecutionPolicy Bypass -File "scripts/verify-before-done.ps1" -TaskId "T###"
```

If it returns `BLOCKED`, fix the issues before completing.

---

## FORBIDDEN

- ❌ Marking done without `epistemic` field
- ❌ Saying `evidence_provided` with empty `verified[]`
- ❌ Completing without any `claims[]`
- ❌ Skipping the verification gate

---

## Examples

### Good Completion
```json
{
    "status": "done",
    "completed": "2026-01-31T22:00:00",
    "epistemic": {
        "verification_status": "evidence_provided",
        "claims": [
            "Created heartbeat-checks.ps1",
            "Reduced heartbeat time from 3s to 600ms"
        ],
        "verified": [
            "File exists: scripts/heartbeat-checks.ps1",
            "Timing test: Measure-Command returned 585ms"
        ]
    }
}
```

### Bad Completion (WILL BE BLOCKED)
```json
{
    "status": "done"
    // No epistemic field = BLOCKED
}
```

---

## Enforcement

The system now enforces this automatically:
1. `verify-before-done.ps1` — Blocks completion without verification
2. `audit-unverified-completions.ps1` — Catches any that slip through
3. Heartbeat check — Reports `unverifiedCompletions` count

**If heartbeat shows unverifiedCompletions > 0, STOP and fix immediately.**
