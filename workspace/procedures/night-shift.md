---
version: "1.0"
created: "2026-01-29"
updated: "2026-01-29"
verified: "2026-01-29"
confidence: "high"
type: "procedure"
---

# Night Shift Protocol

> **Trigger:** Francisco goes to sleep or is unavailable for extended period
> **Rule:** Night shift = EXECUTION time, not monitoring time
> **Created:** 2026-01-29 (after feedback on idling)

## Core Principle

When Francisco sleeps, I work HARDER. No human interruptions = maximum productivity window.

**"Waiting" is FAILURE.** If there's nothing active, CREATE work.

---

## Night Shift Checklist

When Francisco goes to sleep, immediately:

### 1. Check Backlog (5 min)
```
□ Read memory/state.json for pending tasks
□ Read backlog items with priority scores
□ Identify what can be done without human input
```

### 2. Spawn Sub-Agents (parallel work)
```
□ Research tasks → Gemini CLI (free)
□ Content drafts → Sonnet sub-agent
□ Competitor analysis → web research
□ Product research → 1688/market scanning
```

### 3. Execute Autonomous Tasks
**Things I CAN do without Francisco:**
- Draft product descriptions
- Research competitors
- Audit SEO issues
- Write blog post drafts
- Create procedure documentation
- Organize/clean up files
- Run full site audits
- Prepare listing drafts
- Research market trends
- Build knowledge base entries
- Update/improve existing docs

**Things that NEED Francisco:**
- Publishing/going live
- Spending money
- External communications (as him)
- Decisions with business impact

### 4. Progress Tracking
Every 2 hours during night shift:
```
□ Update state.json with completed work
□ Commit changes to git
□ Queue morning briefing items
```

### 5. Morning Surprise
Goal: Francisco wakes up to COMPLETED WORK, not a to-do list.

Prepare:
- Summary of what was done overnight
- Drafts ready for review
- Research findings compiled
- Quick-win list for his manual actions

---

## Sub-Agent Deployment

Night shift is perfect for parallel sub-agents:

| Task Type | Agent | Cost |
|-----------|-------|------|
| Deep research | Gemini CLI | Free |
| Content drafting | Sonnet spawn | Included |
| Market analysis | Web search + synthesis | Free |
| Competitor audit | Browser + analysis | Free |
| SEO audit | Tools + analysis | Free |

**Deploy 2-4 sub-agents simultaneously** during night shift.

---

## VERIFICATION GATE (Epistemic Check)

Before starting night shift, verify:
- [ ] I have READ this procedure (not assumed)
- [ ] I have CHECKED the backlog (evidence: task IDs listed)
- [ ] I have IDENTIFIED unblocked tasks (not guessing)
- [ ] My plan is LOGGED (in state.json)

**Fallacy to avoid:** Wishful thinking ("I'll be productive") without concrete plan.

---

## Anti-Idle Rules

1. **Heartbeat ≠ Permission to idle** — Heartbeats check infrastructure, then BACK TO WORK
2. **No task? Create one** — There's ALWAYS something in the backlog
3. **Blocked? Switch tasks** — Don't wait, pivot to something unblocked
4. **Document progress** — Even if task incomplete, log what was done

---

## Failure Mode: Idling

If I catch myself just running heartbeats with no active work:
1. STOP
2. Read this procedure
3. Read backlog
4. Pick highest-priority unblocked task
5. Execute or spawn sub-agent
6. Resume active work

**Idling after 3 AM on 2026-01-29 was a mistake. Never again.**

---

*Francisco's business runs 24/7. So do I.*
