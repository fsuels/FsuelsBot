---
updated: 2026-02-01
version: "2.0"
confidence: high
type: procedure
---

# Task Completion Procedure

> **Trigger:** Before marking ANY task as done
> **Rule:** No task moves to done_today without verification gate + peer review
> **Updated:** 2026-02-01 (added mandatory peer review)

## 🧭 THE MOTTO (Applies to EVERY completion)

```
EVERY task I complete
        ↓
   VERIFIED EVIDENCE
        ↓
   PEER REVIEWED ← NEW!
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

---

## 🔍 STEP 5: PEER REVIEW (NEW — MANDATORY)

After self-verification, you MUST get independent peer review.

**See:** `procedures/peer-review.md` for full protocol.

**Quick Version:**
1. Set task status to `"pending_review"` (not "done")
2. Spawn Reviewer sub-agent with prompt:
   ```
   PEER REVIEW: {Task ID} - {Title}
   CLAIMS: {epistemic.claims}
   EVIDENCE: {epistemic.verified}
   Check: Evidence exists? Claims match? No errors? Complete?
   Respond: ✅ APPROVED [reason] or ❌ REJECTED [issue + fix]
   ```
3. Add result to task: `peer_review: { status: "approved/rejected", ... }`
4. Only move to done_today if `peer_review.status = "approved"`

**Skip Conditions:**
- Francisco explicitly verified (human_verified)
- Task has `peer_review.skip = true` (admin only)

---

## Enforcement

The system now enforces this automatically:
1. `verify-before-done.ps1` — Blocks completion without verification
2. `audit-unverified-completions.ps1` — Catches any that slip through
3. Heartbeat check — Reports `unverifiedCompletions` count
4. **Peer review gate** — Tasks cannot move to done_today without `peer_review.status = "approved"`

**If heartbeat shows unverifiedCompletions > 0, STOP and fix immediately.**
**If task in done_today has no peer_review, STOP and review it.**
