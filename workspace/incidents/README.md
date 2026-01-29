# Incidents Log

Track every mistake, learn from each one.

## File Format
Each incident: `INC-YYYYMMDD-NNN.md`

## Template
```markdown
# INC-YYYYMMDD-NNN: [Brief Title]

**Date:** YYYY-MM-DD
**Severity:** P0/P1/P2/P3
**Status:** open | investigating | resolved | prevented

## What Happened
[Description of the failure]

## Root Cause
[Why it happened]

## Impact
[What was affected]

## Resolution
[How it was fixed]

## Prevention
- [ ] New rule added to CONSTITUTION.md
- [ ] Procedure updated in AGENTS.md
- [ ] Regression test created
- [ ] No change needed (explain why)

## Lessons Learned
[What we learned]
```

## Process
1. When a mistake happens → create incident file immediately
2. Investigate root cause
3. Implement fix
4. Add prevention measure (rule, test, or procedure)
5. Mark resolved

**Every incident must produce at least one of:**
- New rule in CONSTITUTION.md
- Updated procedure in AGENTS.md
- Regression test
- Documented reason why no change needed
