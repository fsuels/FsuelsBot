---
version: "1.0"
created: "2026-01-28"
updated: "2026-01-28"
verified: "2026-01-28"
confidence: "medium"
---

# Memory System — Complete Architecture

*Version 1.0 — 2026-01-28*
*Council-approved*

## Philosophy

> "You don't get to 100% by making the model remember more. You get there by making forgetting non-fatal."

The goal is not perfect recall. The goal is **fail-safe design** where:
- Even if I forget, the system enforces rules
- Critical state is auto-injected, not recalled
- Every mistake creates permanent prevention
- Redundancy ensures recovery from any failure

---

## The 5 Layers

### Layer 1: Constitution (Inviolable Rules)
**File:** `CONSTITUTION.md`
- P0 rules that CANNOT be overridden
- Checked before any risky action
- Only Francisco can modify

### Layer 2: State Injection (Auto-Context)
**Files:** `state.json` → `AGENTS.md` (render)
- Current task, status, context, next step
- Auto-injected into every response via AGENTS.md
- Survives any context compaction

### Layer 3: Event Log (Audit Trail)
**File:** `events.jsonl`
- Append-only record of all state changes
- Never edited, only appended
- Can reconstruct state if state.json corrupts

### Layer 4: Knowledge Base (Accumulated Wisdom)
**Folders:**
- `knowledge/` — Entities, procedures, principles, insights
- `.learnings/` — Mistakes, corrections, discoveries, patterns
- `incidents/` — Tracked failures with postmortems

### Layer 5: Workflows (Executable Processes)
**Folder:** `workflows/`
- State machine definitions
- Current state tracked in active.json
- Resumable after any interruption

---

## Data Flow

```
Action/Event
    ↓
Update state.json (authoritative)
    ↓
Append to events.jsonl (audit)
    ↓
Re-render AGENTS.md CURRENT STATE
    ↓
State visible in next turn
```

---

## Recovery Protocols

### After Context Compaction
1. CURRENT STATE in AGENTS.md is auto-injected
2. If that fails, read state.json
3. If that fails, reconstruct from events.jsonl
4. If that fails, check incidents/ for last known state

### After System Restart
1. BOOT.md executes
2. Mission Control started
3. Mobile URL sent to Francisco
4. State files validated

### After Mistake
1. Create incident file
2. Investigate root cause
3. Implement fix
4. Add prevention (rule, procedure, or test)
5. Never repeat

---

## File Hierarchy

```
workspace/
├── CONSTITUTION.md      # Inviolable rules
├── AGENTS.md            # Operating procedures + state render
├── SOUL.md              # Identity and values
├── USER.md              # About Francisco
├── BOOT.md              # Startup tasks
├── HEARTBEAT.md         # Periodic checks
│
├── memory/
│   ├── state.json       # Current state (authoritative)
│   ├── events.jsonl     # Audit trail (append-only)
│   ├── active-thread.md # Current work description
│   └── YYYY-MM-DD.md    # Daily logs
│
├── knowledge/
│   ├── entities/        # People, companies, projects
│   ├── procedures/      # How-to guides
│   ├── principles/      # Standing rules
│   └── insights/        # Learned patterns
│
├── .learnings/
│   ├── mistakes/        # What went wrong
│   ├── corrections/     # When Francisco corrects me
│   ├── discoveries/     # New techniques
│   └── patterns/        # Recurring situations
│
├── incidents/
│   └── INC-*.md         # Tracked failures
│
├── workflows/
│   ├── active.json      # Currently running workflows
│   └── *.yml            # Workflow definitions
│
└── tests/
    ├── scenarios/       # Test cases
    └── validators/      # Check scripts
```

---

## Enforcement Mechanisms

1. **Pre-action validation** — Check CONSTITUTION.md before risky actions
2. **Heartbeat checks** — Validate infrastructure every poll
3. **Regression tests** — Catch repeated mistakes
4. **Council review** — Memory changes need multi-AI approval

---

## Standing Rules

1. Memory decisions ALWAYS require Council approval
2. Mission Control must always be running
3. Never stop working
4. Trust files over internal memory
5. Every mistake creates prevention

---

*This document is the authoritative reference for the memory system architecture.*
