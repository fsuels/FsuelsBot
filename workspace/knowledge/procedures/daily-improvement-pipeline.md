# Procedure: Daily Improvement Pipeline
*Created: 2026-01-28*
*Source: Francisco directive via Telegram*
*Priority: P0 — This is how we continuously improve*

## Overview

Every day after the AI research brief, we run improvement opportunities through the Council to filter what's actually worth implementing. Only Council-approved improvements get built, and we implement them one at a time to verify they work.

## The Pipeline

```
Daily Research Brief
        ↓
   Identify Opportunities
        ↓
   Council Review (2 rounds, max 6)
        ↓
   Approved? → Add to approved-improvements.md
        ↓
   Overnight Cron picks from approved list
        ↓
   Implement ONE at a time
        ↓
   Verify it works → Next improvement
```

## Step 1: Daily Research Brief (9 AM)

The existing daily research brief identifies improvement opportunities from:
- AI agent news and techniques
- Clawdbot/Moltbot updates
- New skills and tools
- Expert insights
- Security advisories

**Output:** List of potential improvements in the brief's "Improvement Opportunities" section.

## Step 2: Council Review (After Research Brief)

Run each identified opportunity through the Council:

**Minimum 2 rounds, maximum 6 rounds** (adaptive — continue if real debate happening)

**Question format:**
"I identified this potential improvement from today's research: [IMPROVEMENT]. 

Context: [What it does, why it might help, effort estimate]

Questions:
1. Is this worth implementing for our specific setup? Why or why not?
2. What risks or downsides might we miss?
3. Priority: High/Medium/Low compared to other work?
4. Any modifications to make it better for us?

Give me your honest assessment, not just agreement."

**Debate protocol applies:** Cross-examination (A→B→C), aim for understanding, discover better solutions.

**Approval criteria:** All 3 AIs agree it's worth doing.

## Step 3: Approved Improvements Queue

Approved improvements go to: `mission-control/approved-improvements.md`

Format:
```markdown
## Approved Improvements Queue

### Ready to Implement
| # | Improvement | Source | Approved | Effort | Status |
|---|-------------|--------|----------|--------|--------|
| 1 | Enable Edge TTS | Research 2026-01-28 | Council R2 | 30 min | pending |
| 2 | Add Crabwalk monitoring | Research 2026-01-28 | Council R2 | 1 hr | pending |

### In Progress
- [None]

### Completed
| # | Improvement | Implemented | Verified |
|---|-------------|-------------|----------|
```

## Step 4: Overnight Implementation (2 AM Cron)

The existing overnight-self-improvement cron **ONLY picks from the approved queue**.

**Rules:**
- Pick the TOP item from "Ready to Implement" (priority order)
- Move it to "In Progress"
- Implement it
- Test it
- If works: Move to "Completed" with date
- If fails: Note the failure, move back to Ready with "[needs-review]" flag
- Document in overnight-builds/YYYY-MM-DD.md

**The cron CANNOT invent improvements** — only implements what Council already approved.

## Step 5: Verification

Before marking complete:
- Test the improvement actually works
- Document what was changed
- Note any issues discovered

If verification fails, the improvement stays in queue with notes for manual review.

## Integration with Existing Crons

### Daily Research Brief (9 AM)
After sending brief to Francisco, automatically trigger Council review for any opportunities identified.

### Overnight Self-Improvement (2 AM)
Modified to: Read approved-improvements.md, pick top item, implement, verify.

## Notes

- **One at a time** — Never batch multiple improvements. Verify each works before starting next.
- **Council is the gatekeeper** — No improvement gets implemented without 2+ rounds of Council approval.
- **Small scope** — Overnight builds should be 15-30 min max. Larger improvements need Francisco's direct approval.
- **Transparency** — All approved improvements are visible in the queue. Francisco can reorder or veto.
