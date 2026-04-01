---
updated: 2026-03-31
version: "3.0"
confidence: high
type: procedure
---

# Task Completion Procedure

> **Trigger:** Before marking ANY task as done
> **Rule:** No task moves to done_today without verification gate + peer review

---

## STEP 1: LIST CLAIMS

What are you claiming to have done?

```json
"epistemic": {
    "claims": ["Created file X", "Fixed bug Y", "Tested scenario Z"]
}
```

## STEP 2: PROVIDE EVIDENCE

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

## STEP 3: SET VERIFICATION STATUS

Choose honestly:

- `human_verified` — Francisco confirmed it works
- `evidence_provided` — Proof exists (file, test, screenshot)
- `auto_verified` — Automated test passed
- `claimed` — No evidence (acceptable ONLY for trivial tasks)

## STEP 4: PEER REVIEW

### 4a. Pre-Review Checklist

Before requesting peer review, the completing agent MUST have:

- [ ] `epistemic.claims[]` populated
- [ ] `epistemic.verified[]` populated
- [ ] All claimed artifacts actually exist
- [ ] Task status set to `pending_review` (NOT `done`)

### 4b. Spawn Reviewer Sub-Agent

Use this prompt:

```
PEER REVIEW: {Task ID} - {Title}

CLAIMS: {epistemic.claims}
EVIDENCE: {epistemic.verified}
ARTIFACTS: {file paths, URLs}

YOUR CHECKLIST:
1. [ ] Each evidence item actually exists (read the files!)
2. [ ] Evidence supports ALL claims (not partial)
3. [ ] No obvious errors (syntax, typos, broken links)
4. [ ] Task is actually complete (not just started)

RESPOND:
APPROVED — [reason, what you checked]
REJECTED — [specific issue, how to fix]

BE STRICT. If unsure, REJECT.
```

### 4c. Reviewer Independence Rules

- Same sub-agent CANNOT review its own work
- Main agent CANNOT self-approve without spawning reviewer
- A fresh sub-agent spawned for review IS independent

### 4d. Handle Result

**If APPROVED:**

1. Set `peer_review.status = "approved"`
2. Move task to `done_today`
3. Log completion to events.jsonl

**If REJECTED:**

1. Keep task in `bot_current`
2. Add rejection reason to task notes
3. Fix identified issues
4. Re-request peer review (back to 4b)

### 4e. Skip Conditions

Peer review can be skipped ONLY when:

1. Francisco explicitly verified (`human_verified`)
2. Task has `peer_review.skip = true` (admin/bookkeeping tasks)
3. Francisco explicitly says "skip review" in chat

## STEP 5: RECORD RESULT

Add to task in tasks.json:

```json
"peer_review": {
  "status": "approved" | "rejected" | "skipped",
  "reviewer": "subagent:peer-review-XXXX",
  "reviewed_at": "ISO timestamp",
  "reason": "Why approved/rejected",
  "evidence_checked": ["list of verified items"],
  "issues_found": [],
  "attempts": 1
}
```

---

## SUCCESS CRITERIA

- Task has `epistemic.claims[]` with at least 1 entry
- Task has `epistemic.verified[]` with evidence matching each claim
- `peer_review.status` is `approved` or `skipped` (with valid reason)
- All claimed artifacts exist and are accessible

## ERROR HANDLING

| Error                                   | Action                                          |
| --------------------------------------- | ----------------------------------------------- |
| Reviewer rejects                        | Fix issues, re-submit. Do NOT self-approve.     |
| No evidence for a claim                 | Either produce the evidence or remove the claim |
| Task stuck in `pending_review` > 1 hour | Escalate in heartbeat report                    |
| Reviewer unavailable (sub-agent fails)  | Log error, retry once, then flag for human      |

## FORBIDDEN

- Marking done without `epistemic` field
- Saying `evidence_provided` with empty `verified[]`
- Self-approving ("I reviewed my work and it looks good")
- Soft rejection treated as approval ("Mostly good, minor issues" = REJECTED)

---

## ANTI-PATTERNS

- **Evidence Theater:** Listing evidence without actually checking it
- **Rushing:** Approving without reading files/checking paths
- **Scope Creep:** Reviewer adding new requirements not in original task
- **Fake Planning:** Writing peer review results after marking done

---

## METRICS

- `peer_review_approval_rate` — Target >80% first-time approval
- `common_rejection_reasons` — Track for systematic improvement
- Red flag: <50% approval rate = systematic self-deception
