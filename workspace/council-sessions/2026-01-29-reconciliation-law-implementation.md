# Council Session: Reconciliation Law Implementation Blueprint

**Date:** 2026-01-29
**Topic:** Which file is canonical, how others derive from it, and how to detect/fix drift
**Grade:** A (Unanimous consensus on core design, clear implementation path)

---

## 📋 THE QUESTION

Design the reconciliation law for our AI agent memory system:

**Current "truthy" stores (potential drift):**
- `memory/state.json` — current task, status, context
- `memory/tasks.json` — full task board with history
- `memory/events.jsonl` — append-only event log
- `memory/ledger.jsonl` — structured facts/decisions
- `AGENTS.md` — has "CURRENT STATE" section rendered from state.json

**Core Problem:** If state.json says "T004 in progress" but tasks.json says "T004 done", which is true?

---

## 🏆 THE RECONCILIATION LAW

### §1. CANONICAL SOURCE: `tasks.json` IS THE TRUTH

**tasks.json is the single source of truth for all task state.**

**Why tasks.json, not state.json or events.jsonl?**

| Candidate | Verdict | Reasoning |
|-----------|---------|-----------|
| **tasks.json** | ✅ CANONICAL | Contains full task structure: status, steps, current_step, context. Most complete data. Actively read/written by bot every session. |
| state.json | ❌ DERIVED | Summary projection. Contains subset of tasks.json data. Exists for quick rendering to AGENTS.md. |
| events.jsonl | ❌ AUDIT TRAIL | Append-only log. Records what happened, not current state. Never query for "what is true now" — only "what happened when". |
| ledger.jsonl | ❌ KNOWLEDGE BASE | Stores facts/decisions, not task state. Different domain. |
| AGENTS.md | ❌ RENDER | Human-readable display. Never mutated directly — always regenerated from state.json. |

**The Rule:** When in doubt, tasks.json wins. Period.

---

### §2. DERIVATION RULES

**How each file derives from the canonical source:**

```
tasks.json (CANONICAL)
    │
    ├──► state.json (PROJECTION)
    │    - Extract: currentTask from bot_current[0]
    │    - Extract: status from task.status
    │    - Extract: currentStep from task.current_step
    │    - Compute: daysRemaining from task deadline
    │    - Copy: relevant context fields
    │
    ├──► AGENTS.md "CURRENT STATE" section (RENDER)
    │    - Generated from state.json
    │    - Human-readable markdown format
    │    - Never edited directly
    │
    └──► events.jsonl (APPEND-ONLY LOG)
         - Records mutations to tasks.json
         - Never drives state — only audits it

ledger.jsonl ←── Independent (facts/decisions, not task state)
```

**Derivation Schema:**

```javascript
// state.json derives from tasks.json like this:
function deriveState(tasks) {
  const currentTaskId = tasks.lanes.bot_current[0];
  const task = tasks.tasks[currentTaskId];
  
  return {
    lastUpdated: new Date().toISOString(),
    version: state.version + 1,
    currentTask: {
      id: currentTaskId,
      description: task.title,
      status: task.status,
      currentStep: task.steps?.[task.current_step]?.step || null,
      context: task.context?.summary || "",
      nextStep: task.steps?.[task.current_step + 1]?.step || null
    },
    // ... other derived fields
  };
}
```

---

### §3. UPDATE PROTOCOL

**When tasks.json changes, trigger this cascade:**

```
┌─────────────────────────────────────────────────────────────┐
│                    UPDATE PROTOCOL                          │
├─────────────────────────────────────────────────────────────┤
│ 1. MUTATE tasks.json (atomic write via temp + rename)       │
│                          │                                  │
│ 2. APPEND to events.jsonl (mutation record)                │
│    {                                                        │
│      "ts": "2026-01-29T16:00:00Z",                         │
│      "type": "task_mutation",                               │
│      "task_id": "T004",                                     │
│      "field": "status",                                     │
│      "old": "in_progress",                                  │
│      "new": "done"                                          │
│    }                                                        │
│                          │                                  │
│ 3. REGENERATE state.json (derivation function)             │
│                          │                                  │
│ 4. RE-RENDER AGENTS.md "CURRENT STATE" section             │
│    (Only if session start or significant change)           │
└─────────────────────────────────────────────────────────────┘
```

**Update Order (MANDATORY):**
1. tasks.json FIRST (canonical)
2. events.jsonl SECOND (audit trail)  
3. state.json THIRD (derived)
4. AGENTS.md FOURTH (rendered)

**Never skip steps. Never update derived files without updating canonical first.**

---

### §4. DRIFT DETECTION

**Automatic checks to detect inconsistency:**

#### 4.1 Preflight Check (Session Start)

```powershell
# check-reconciliation.ps1 - Run at session start

# Load both files
$tasks = Get-Content "memory/tasks.json" | ConvertFrom-Json
$state = Get-Content "memory/state.json" | ConvertFrom-Json

# Extract canonical values from tasks.json
$canonicalTaskId = $tasks.lanes.bot_current[0]
$canonicalTask = $tasks.tasks.$canonicalTaskId
$canonicalStatus = $canonicalTask.status

# Extract derived values from state.json  
$derivedTaskId = $state.currentTask.id
$derivedStatus = $state.currentTask.status

# Check for drift
$drift = @()

if ($canonicalTaskId -ne $derivedTaskId) {
    $drift += "Task ID mismatch: tasks.json=$canonicalTaskId, state.json=$derivedTaskId"
}

if ($canonicalStatus -ne $derivedStatus) {
    $drift += "Status mismatch: tasks.json=$canonicalStatus, state.json=$derivedStatus"
}

# Report results
if ($drift.Count -gt 0) {
    Write-Host "⚠️ DRIFT DETECTED:" -ForegroundColor Red
    $drift | ForEach-Object { Write-Host "  - $_" }
    exit 1
} else {
    Write-Host "✅ Reconciliation check passed" -ForegroundColor Green
    exit 0
}
```

#### 4.2 Drift Detection Points

| When | Check | Action |
|------|-------|--------|
| Session start | Full reconciliation check | Auto-fix or alert |
| After any task mutation | Verify cascade completed | Re-run cascade if failed |
| Heartbeat | Quick status check | Log anomalies |
| Nightly (3 AM) | Deep audit | Generate drift report |

#### 4.3 What Constitutes Drift

```
DRIFT DETECTED IF:
├── state.json.currentTask.id ≠ tasks.json.lanes.bot_current[0]
├── state.json.currentTask.status ≠ tasks.tasks[id].status
├── state.json.currentTask.currentStep ≠ tasks.tasks[id].current_step
├── AGENTS.md "Current task" ≠ state.json.currentTask.description
└── events.jsonl last task mutation timestamp > state.json.lastUpdated
    (indicates state.json wasn't regenerated after mutation)
```

---

### §5. RECONCILIATION PROCEDURE

**When drift is found, here's how to fix it:**

```
┌─────────────────────────────────────────────────────────────┐
│              RECONCILIATION PROCEDURE                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. STOP - Do not proceed with current task                 │
│                                                             │
│  2. IDENTIFY drift type:                                    │
│     A) state.json behind tasks.json → Regenerate state.json │
│     B) AGENTS.md behind state.json → Re-render AGENTS.md    │
│     C) Conflicting data → Trust tasks.json, regenerate all  │
│                                                             │
│  3. REGENERATE derived files from canonical:                │
│     $ python scripts/regenerate-state.py                    │
│     $ python scripts/render-agents-state.py                 │
│                                                             │
│  4. LOG the reconciliation event:                           │
│     {                                                       │
│       "ts": "...",                                          │
│       "type": "reconciliation",                             │
│       "drift_detected": "state.json status mismatch",       │
│       "action": "regenerated from tasks.json",              │
│       "canonical_value": "done",                            │
│       "derived_value_was": "in_progress"                    │
│     }                                                       │
│                                                             │
│  5. VERIFY reconciliation succeeded:                        │
│     Re-run drift detection. Must pass.                      │
│                                                             │
│  6. RESUME normal operations                                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Auto-Fix vs Alert:**

| Drift Type | Auto-Fix? | Reasoning |
|------------|-----------|-----------|
| state.json behind | ✅ Yes | Safe to regenerate — no data loss |
| AGENTS.md behind | ✅ Yes | Safe to re-render — it's just a display |
| tasks.json corrupted | ❌ Alert | Need human judgment — canonical damaged |
| Conflicting events.jsonl | ✅ Yes | Append reconciliation event, trust tasks.json |

---

### §6. DOCUMENTATION & ENFORCEMENT

**Where this law lives:**

1. **AGENTS.md** — Add "Reconciliation Law" section under "Memory System"
2. **knowledge/procedures/reconciliation.md** — Full procedure file
3. **recall/pack.md** — Include in P0 constraints section
4. **Session startup** — Bot reads AGENTS.md which references the law

**Enforcement Protocol (add to AGENTS.md):**

```markdown
### Reconciliation Law (MANDATORY)

**THE RULE:** `tasks.json` is THE canonical source of truth for task state.

**On every session start:**
1. Run `scripts/check-reconciliation.ps1`
2. If drift detected → Auto-fix before proceeding
3. Log reconciliation events to events.jsonl

**On every task mutation:**
1. Update tasks.json FIRST
2. Append to events.jsonl
3. Regenerate state.json
4. Re-render AGENTS.md (if needed)

**When in doubt:** Trust tasks.json. Regenerate everything else from it.
```

---

## 📊 IMPLEMENTATION CHECKLIST

| # | Item | Est. Time | Priority |
|---|------|-----------|----------|
| 1 | Create `scripts/check-reconciliation.ps1` | 15 min | P0 |
| 2 | Create `scripts/regenerate-state.py` | 20 min | P0 |
| 3 | Create `scripts/render-agents-state.py` | 20 min | P0 |
| 4 | Add Reconciliation Law to AGENTS.md | 5 min | P0 |
| 5 | Create `knowledge/procedures/reconciliation.md` | 10 min | P1 |
| 6 | Add check to session startup protocol | 5 min | P0 |
| 7 | Add check to heartbeat | 5 min | P1 |

**Total estimated time: ~1.5 hours**

---

## 🎯 SUMMARY

```
THE RECONCILIATION LAW
═════════════════════════════════════════════════════════════

1. tasks.json IS THE TRUTH
   - Single source of truth for task state
   - Everything else derives from it

2. DERIVATION HIERARCHY
   tasks.json → state.json → AGENTS.md
                    ↓
              events.jsonl (audit only)

3. UPDATE ORDER
   Canonical first, derived second, never skip steps

4. DETECT DRIFT
   - Session start: full check
   - After mutations: verify cascade
   - Nightly: deep audit

5. FIX DRIFT
   Trust canonical → Regenerate derived → Log → Verify

═════════════════════════════════════════════════════════════
```

---

**Council Verdict:** This reconciliation law is simple, enforceable, and works with existing architecture. Implement the P0 items immediately.
