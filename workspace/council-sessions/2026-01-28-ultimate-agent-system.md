# 🧠 THE COUNCIL — Ultimate Agent System Architecture
## Full Feedback Loop Session | January 28, 2026

### 📋 QUESTION
> I'm building a personal AI assistant (runs on Claude Opus 4.5, local machine, Telegram interface) that manages a soloentrepreneur's entire business. The system needs to solve THREE problems that no AI assistant has fully solved yet:
> 1. **PERFECT MEMORY** — The AI wakes up fresh each session with no memory. How do you architect a memory system that ensures NOTHING important is ever forgotten?
> 2. **GUARANTEED TASK COMPLETION** — Tasks get created but fall through cracks. How do you guarantee every task reaches completion?
> 3. **CONTINUOUS SELF-IMPROVEMENT** — The system should get measurably better every day without human intervention.

### 📊 PANEL
| AI | Model | Access | Round 1 | Round 2 |
|---|---|---|---|---|
| Grok | Grok 4.1 Thinking | X/Grok browser | ✅ | ✅ |
| ChatGPT | GPT 5.2 | chatgpt.com browser | ✅ | ✅ |
| Gemini | Gemini CLI | Terminal | ✅ | ✅ |

---

## 🔵 ROUND 1 — First Take

### 🤖 GROK (Round 1)
**Approach: "Simple & Buildable Today"**

- **Memory:** Daily .md logs + MEMORY.md master + per-topic files in TOPICS/. Priority tagging P0-P3. Simple regex/grep search for recall. Nightly consolidation via Claude prompt. P2/P3 pruning after 90 days.
- **Tasks:** Single `tasks.json` file. 5-state machine (NEW → IN_PROGRESS → BLOCKED → DONE → ARCHIVED). 3-level escalation (reminder → sub-agent → dead-man switch). Weekly accountability reports.
- **Self-Improvement:** `performance.json` with daily metrics arrays. A/B testing via even/odd day prompt alternation. Overnight reflection agent proposes exactly 3 improvements and rewrites `system_prompt.md`.
- **Architecture:** 4 Python scripts under 100 lines each, zero external dependencies. Only 4 cron jobs.
- **Strengths:** Extreme simplicity. Can literally be built in an afternoon. Zero risk of over-engineering paralysis.
- **Weaknesses:** No immutability/auditability. Grep-based search fails semantically. Single tasks.json is a corruption risk. A/B testing is statistically weak.

### 🟢 CHATGPT (Round 1)
**Approach: "Event-Sourced Enterprise"**

- **Memory:** Append-only JSONL ledger as single source of truth. SQLite FTS5 for indexing. Structured memory types (fact, decision, preference, commitment, relationship, asset, procedure, context, reflection). "Recall Pack" injected at every planning step with trigger words. Contradiction detection. Subject-predicate-object triple structure.
- **Tasks:** Event-sourced `tasks.jsonl` + `state.sqlite` materialized view. 10-state machine (CAPTURED, TRIAGED, PLANNED, READY, EXECUTING, WAITING_EXTERNAL, BLOCKED_INTERNAL, VERIFYING, DONE, CANCELLED). Definition of Done with completion proofs. 5-level escalation (L0 silent → L4 dead-man switch blocking ALL new work).
- **Self-Improvement:** `ops/incidents.jsonl` with typed failures (MISSED_DEADLINE, WRONG_RECALL, BAD_EXTRACTION, etc.). Experiments registry with A/B testing, guardrails, and automatic rollback. Nightly offline eval replaying yesterday's transcripts. Council as evaluation oracle.
- **Architecture:** 7+ Python scripts. SQLite databases. Cron every 1-5 minutes.
- **Strengths:** Most thorough and rigorous. Immutable audit trail. Rebuild-from-ledger guarantee. Sophisticated experiments framework.
- **Weaknesses:** Very complex. 10-state machine may cause analysis paralysis. 1-minute cron is aggressive for a solo user. Risk of never shipping due to scope.

### 💎 GEMINI (Round 1)
**Approach: "Cortex + Second Brain"**

- **Memory:** "Cortex" lightweight orchestrator checks file state, only wakes Claude when needed. "Second Brain" knowledge base with categorized directories: entities/, procedures/, principles/, insights/. Dual logging (raw .md + structured JSONL). Index.json for fast retrieval. Nightly consolidation produces typed outputs (new_entities, updated_entities, etc.).
- **Tasks:** Individual JSON files per task (one file = one task). 5-state machine (PENDING, ACTIVE, BLOCKED, COMPLETED, FAILED). Failed tasks auto-create high-priority RCA tasks (dead-man switch). Board.md auto-generated from task files.
- **Self-Improvement:** "Patch" system (proposed → council critique → validated → applied). Council as "Critics" reviewing improvements before deployment. Overnight changelog. Virtuous cycle: failures → patches → updated procedures → better recall.
- **Architecture:** Master `cortex.py` script. Cron every 1-5 minutes.
- **Strengths:** Elegant "Second Brain" categorization. Patch pipeline is brilliant. Virtuous cycle insight. Resource-efficient (only wake Claude when needed).
- **Weaknesses:** No event sourcing means mutable state can lose history. Per-task files don't scale well past ~50 tasks. No formal metrics or experiments framework.

---

## 🔴 ROUND 2 — Cross-Critique & Improve

### 🤖 GROK (Round 2): "Resilient Core"
**After seeing ChatGPT + Gemini's proposals:**

Grok acknowledged its Round 1 grep-based search was a weakness and adopted:
- **Immutable `events.jsonl`** as single source of truth (from ChatGPT)
- **SQLite FTS5** for indexed search (from ChatGPT)
- **Second Brain categorized knowledge** (from Gemini)
- **7-state task machine** (merged: CAPTURED → TRIAGED → PLANNED → READY → EXECUTING → DONE/CANCELLED + BLOCKED flag)
- **Council-gated patch pipeline** (from Gemini, formalized)
- **Experiments registry with rollback** (from ChatGPT)
- Maintained simplicity: all scripts use Python stdlib only (sqlite3 is built-in)
- **4-level escalation** (L0 silent, L1 daily reminder, L2 sub-agent, L3 block new tasks)
- Implementation in phases: (1) Add events.jsonl, (2) Add SQLite, (3) Port tasks/memory to DB, (4) Add patch pipeline

**Key insight:** "Still 100% implementable today with stdlib Python — just add sqlite3 usage to scripts (~50 new lines total)."

### 🟢 CHATGPT (Round 2): "Ledger + Materialized Views + Orchestrator + Patches"
**After seeing Grok + Gemini's proposals:**

ChatGPT maintained its event-sourced core and incorporated:
- **Minute-level orchestrator** with deterministic wake rules (from Gemini's Cortex)
- **Per-task snapshot files** alongside event log for convenience (from Gemini's atomic files)
- **Typed consolidation deltas** (from Gemini: new_entities, updated_entities, etc.)
- **Patch lifecycle system** with proposed/active/applied/rolled_back directories (from Gemini)
- **Council-as-Critics** reviewing patches (from Gemini)
- Kept 10-state machine, 5-level escalation, experiments registry
- Added explicit `wake_rules.yaml` for deterministic orchestrator behavior
- **Recall Pack as first-class artifact** (recall_cache.json, mandatory injection)

**Key insight:** "The reconciler every 5 minutes with next_check invariant IS the guarantee. Without it, any architecture drops tasks."

### 💎 GEMINI (Round 2): "Pragmatic Hybrid"
**After seeing Grok + ChatGPT's proposals:**

Gemini critiqued both:
- Grok's grep-based memory "will become unusably slow"
- ChatGPT's 10-state machine "creates unnecessary overhead"
- "Both missed vector embeddings for semantic search"

Incorporated:
- **SQLite FTS5** for keyword search (from ChatGPT)
- **Vector database** (ChromaDB/LanceDB) for semantic search (unique addition)
- **Definition of Done** with completion proofs (from ChatGPT)
- **7-state machine** (PENDING, READY, ACTIVE, WAITING, BLOCKED, DONE, ARCHIVED)
- **Incident logging** with typed failures (from ChatGPT)
- **Experiments registry** (simplified version)
- Maintained atomic per-task files

**Key insight:** "The dual-index (FTS + vector) approach provides comprehensive, fast, and intelligent recall."

---

## 🏆 ROUND 3 — OPUS FINAL VERDICT

### What Survived Every Round (High Confidence)

All three AIs converged on these principles after cross-critique:

1. **Append-only event ledgers** (JSONL) as the immutable source of truth — NOT mutable summary files
2. **SQLite for derived state** — FTS5 for search, materialized views for task state
3. **Priority system P0-P3** with strict retention rules
4. **Nightly "sleep" consolidation** that updates knowledge without destroying the ledger
5. **Proactive recall injection** into every planning/execution prompt
6. **Council-gated patch pipeline** for self-improvement (propose → critique → apply/rollback)
7. **Task reconciler running frequently** to enforce next_check invariants
8. **Escalation ladder** with dead-man switch for P0 tasks
9. **Incident logging** as fuel for the improvement loop
10. **Typed memory events** (fact, decision, preference, commitment, procedure, etc.)

### What Got Killed

- **Single mutable `tasks.json`** (Grok R1) — killed by everyone. Corruption risk, no audit trail.
- **Grep/regex search** (Grok R1) — killed. Doesn't scale, no semantic understanding.
- **10-state task machine** (ChatGPT) — killed by Grok and Gemini. 7 states is the sweet spot.
- **Per-task atomic files as sole source** (Gemini R1) — killed. Need event log for auditability.
- **Even/odd day A/B testing** (Grok R1) — killed. Statistically weak, confounded by weekday effects.
- **Vector embeddings** (Gemini R2) — KILLED BY BUDGET. Requires embedding model API or local GPU. Zero budget means no embeddings for now.

### What I (Opus) Add That None of Them Said

1. **Start with what we ALREADY have.** The existing Clawdbot workspace has `memory/*.md`, `MEMORY.md`, cron jobs, sub-agent spawning, and a Mission Control dashboard. The architecture must EVOLVE from the current system, not replace it. No AI mentioned migration strategy.

2. **The AI IS the processor.** All three proposed external Python scripts for consolidation, reconciliation, etc. But in our system, Claude IS the bot — it reads files at session start, writes them during sessions, and cron jobs spawn Claude sub-agents to do maintenance work. There's no separate Python pipeline to build. The scripts ARE Claude prompts executed via cron-spawned sub-agents.

3. **Context window is the constraint, not storage.** With 200K token context windows, the real challenge isn't storing memories — it's selecting the RIGHT 5-10 pages to inject each session. The Recall Pack concept is the most important innovation across all proposals.

4. **SQLite is premature for our system.** Clawdbot operates on markdown files that Claude reads/writes directly. Adding SQLite means Claude can't read/write the database directly — you'd need wrapper scripts. For a solopreneur, **well-structured markdown + JSON files that Claude can read natively** beats a database it can't touch. Use JSONL ledgers (Claude CAN append to these) but skip SQLite until the file count exceeds ~500.

5. **The Council itself IS the improvement engine.** We already have the multi-AI council. Instead of building elaborate patch pipelines, USE THE COUNCIL for nightly improvement sessions. Run a council session every night asking "What went wrong today and how do we fix it?" — this is free and immediate.

---

## 🏗️ THE ULTIMATE ARCHITECTURE — What We're Actually Building

### Design Principles
1. **Files Claude can read/write natively** (markdown + JSON + JSONL)
2. **Append-only event logs** for immutability
3. **Structured markdown** for human readability AND machine parsing
4. **Cron-spawned sub-agents** for maintenance (not external Python scripts)
5. **Evolve from current system** — don't rip and replace

### File Structure (Evolution of Current Workspace)

```
workspace/
├── memory/                        # EXISTING — keep daily logs
│   ├── YYYY-MM-DD.md             # Daily session logs (keep as-is)
│   └── ledger.jsonl              # NEW: append-only memory events
├── MEMORY.md                      # EXISTING — becomes "generated view"
├── knowledge/                     # NEW: Second Brain (from Gemini)
│   ├── entities/                  # People, companies, projects
│   ├── procedures/                # How-to guides for the AI
│   ├── principles/                # Rules, preferences, constraints
│   └── insights/                  # Learned patterns and connections
├── tasks/                         # NEW: replaces ad-hoc task tracking
│   ├── events.jsonl              # Append-only task state changes
│   ├── active/                   # One JSON per active task
│   │   └── TASK-20260128-001.json
│   ├── done/                     # Completed tasks (with proofs)
│   └── views/
│       ├── today.md              # Auto-generated daily focus
│       └── accountability.md     # Weekly report
├── ops/                           # NEW: operational intelligence
│   ├── incidents.jsonl           # Append-only failure log
│   ├── metrics/
│   │   └── YYYY-MM-DD.json      # Daily metrics snapshot
│   ├── patches/
│   │   ├── proposed/
│   │   └── applied/
│   └── experiments.json          # A/B test registry
├── recall/                        # NEW: proactive recall system
│   ├── pack.md                   # Current recall pack (regenerated daily)
│   └── triggers.json             # Recall trigger rules
├── HEARTBEAT.md                   # EXISTING — enhanced with task checks
└── skills/council/                # EXISTING — council skill
```

### 1. PERFECT MEMORY — The Architecture

#### Layer 1: Raw Capture (Already Working)
- `memory/YYYY-MM-DD.md` — Keep exactly as-is. Every session logs here.
- Enhancement: At end of each session, append structured extracts:
```markdown
## Priority Extracts
- [P0] Client X deadline moved to Feb 15
- [P1] Decided on tiered pricing model
- [P2] User prefers bullet points over paragraphs
```

#### Layer 2: Event Ledger (NEW)
- `memory/ledger.jsonl` — One JSON object per line, append-only, NEVER edited:
```json
{"ts":"2026-01-28T14:03:11","type":"commitment","priority":"P0","content":"Follow up Client X by Feb 1","entity":"client_x","tags":["sales","deadline"],"source":"memory/2026-01-28.md","session":"main"}
{"ts":"2026-01-28T14:15:00","type":"decision","priority":"P1","content":"Adopt tiered pricing model","tags":["pricing","strategy"],"source":"memory/2026-01-28.md","session":"main"}
{"ts":"2026-01-28T15:00:00","type":"preference","priority":"P2","content":"User prefers concise bullet points","tags":["style"],"source":"memory/2026-01-28.md","session":"main"}
```
- **Types:** fact, decision, preference, commitment, constraint, procedure, relationship, insight, conflict
- **Priority:** P0 (permanent/critical), P1 (important), P2 (contextual), P3 (ephemeral)

#### Layer 3: Knowledge Base (NEW — Second Brain)
- `knowledge/entities/client_x.md` — Canonical page per entity
- `knowledge/procedures/publish_blog_post.md` — Step-by-step guides
- `knowledge/principles/communication_style.md` — Standing rules
- `knowledge/insights/q4_sales_correlation.md` — Learned wisdom
- Updated nightly by consolidation sub-agent

#### Layer 4: Recall Pack (NEW — The Missing Piece)
- `recall/pack.md` — Regenerated daily at 3 AM + on-demand:
```markdown
# Recall Pack — 2026-01-28

## 🔴 P0 CONSTRAINTS (always active)
- Client X deadline: Feb 15 (follow up by Feb 1)
- Monthly budget: $0 for new tools

## 📋 OPEN COMMITMENTS
- Send Q4 report to accountant by Jan 31
- Reply to Scott about shipping timeline

## ⏳ WAITING ON
- BuckyDrop: shipping quotes (last follow-up: Jan 27)

## 🎯 TODAY'S FOCUS
- Task TASK-001: Draft pricing page (due today)
- Task TASK-003: Review ad performance (due tomorrow)

## 📚 RELEVANT PROCEDURES
- [Loaded based on today's task types]
```
- **Injected into EVERY session** as part of context loading
- **Trigger-based expansion:** When user says "pay", "send", "publish", "decide" → load additional relevant knowledge files

#### Consolidation Cron (3 AM daily)
- Sub-agent spawned with prompt: "Read today's memory/YYYY-MM-DD.md. Extract structured events into memory/ledger.jsonl. Update knowledge/ files. Regenerate recall/pack.md. Report what changed."
- Produces `knowledge/consolidation-reports/YYYY-MM-DD.md`

#### Pruning Rules
- P0: NEVER pruned
- P1: Kept indefinitely, consolidated quarterly
- P2: Archived after 90 days
- P3: Archived after 30 days
- "Archived" = moved to memory/archive/, still searchable but not auto-loaded

### 2. GUARANTEED TASK COMPLETION — The Architecture

#### Task Schema (`tasks/active/TASK-20260128-001.json`)
```json
{
  "id": "TASK-20260128-001",
  "title": "Draft pricing page for DLM",
  "description": "Create tiered pricing page based on Jan 28 strategy decision",
  "status": "PLANNED",
  "priority": "P1",
  "created": "2026-01-28T14:20:00",
  "due": "2026-01-30T17:00:00",
  "next_check": "2026-01-29T09:00:00",
  "next_action": "Draft 3 pricing tiers based on knowledge/decisions/pricing_strategy.md",
  "definition_of_done": [
    "Pricing page HTML created",
    "Reviewed by Francisco",
    "Published to Shopify"
  ],
  "dependencies": [],
  "owner": "claude_main",
  "escalation_level": 0,
  "history": [
    {"ts": "2026-01-28T14:20:00", "event": "CREATED", "detail": "From session discussion"},
    {"ts": "2026-01-28T14:25:00", "event": "TRIAGED", "detail": "P1, due Jan 30"},
    {"ts": "2026-01-28T14:30:00", "event": "PLANNED", "detail": "Next action: draft tiers"}
  ],
  "completion_proof": null
}
```

#### State Machine (8 States)
```
CAPTURED → TRIAGED → PLANNED → READY → EXECUTING → VERIFYING → DONE
                                  ↕                      ↕
                              WAITING_EXTERNAL    BLOCKED_INTERNAL
                                  
Any non-terminal state → CANCELLED (with reason)
```

**Required fields per state:**
- TRIAGED: priority, due, definition_of_done[]
- PLANNED: next_action, next_check
- WAITING_EXTERNAL: who_waiting_on, followup_cadence, last_followup
- DONE: completion_proof (file path, message link, or text summary)

#### Task Event Log (`tasks/events.jsonl`)
```jsonl
{"ts":"2026-01-28T14:20:00","task_id":"TASK-20260128-001","event":"CREATED","actor":"main","detail":"From session discussion"}
{"ts":"2026-01-28T14:25:00","task_id":"TASK-20260128-001","event":"TRIAGED","actor":"main","detail":"P1, due Jan 30, DoD set"}
```

#### The Reconciler (THE GUARANTEE)
**Cron: Every 30 minutes during business hours (8 AM - 10 PM)**
**How: Spawns a sub-agent with label "task-reconciler"**

The reconciler reads all `tasks/active/*.json` and enforces:

1. **Every task MUST have `next_check`** — if missing, set to NOW
2. **If `now > next_check`:**
   - READY → ping Telegram: "Task X is ready to work on"
   - WAITING_EXTERNAL → check followup cadence, draft follow-up message
   - BLOCKED_INTERNAL → escalate with blocking question
3. **Staleness detection:**
   - P0 with no progress > 6h → escalate immediately
   - P1 with no progress > 24h → Telegram reminder
   - P2 with no progress > 72h → auto-create "unstick" subtask
4. **Deadline proximity:**
   - Due within 24h + not EXECUTING → emergency ping
   - Overdue → incident logged + escalation bumped

#### Escalation Ladder
| Level | Trigger | Action |
|---|---|---|
| E0 | Task exists | Visible on dashboard |
| E1 | Stale or approaching deadline | Telegram reminder |
| E2 | Still stale after E1 | Spawn sub-agent "Task Closer" to advance |
| E3 | Still stuck after E2 | Council review: "What am I missing on this task?" |
| E4 | P0 overdue | **DEAD-MAN SWITCH**: Block new P2/P3 work. Repeat alert every 2h until acknowledged. |

#### Dead-Man Switch Details
- Only triggers for P0 tasks
- Sets `HEARTBEAT.md` to include: "⚠️ BLOCKED: P0 task [ID] is overdue. Must resolve before other work."
- Every heartbeat poll sees this and reminds Francisco
- Cleared only when task moves to DONE or CANCELLED with explicit reason

### 3. CONTINUOUS SELF-IMPROVEMENT — The Architecture

#### Incident Logging (`ops/incidents.jsonl`)
Auto-logged on:
```jsonl
{"ts":"2026-01-28","type":"MISSED_DEADLINE","task_id":"TASK-20260125-003","detail":"Due Jan 27, completed Jan 28","severity":"medium"}
{"ts":"2026-01-28","type":"WRONG_RECALL","detail":"Failed to recall Client X preference during pricing discussion","severity":"high"}
{"ts":"2026-01-28","type":"TASK_STUCK","task_id":"TASK-20260126-001","detail":"No progress for 48h","severity":"medium"}
{"ts":"2026-01-28","type":"BAD_EXTRACTION","detail":"User mentioned commitment but no task was created","severity":"high"}
```

**Incident types:** MISSED_DEADLINE, TASK_STUCK, WRONG_RECALL, BAD_EXTRACTION, EXECUTION_FAILURE, QUALITY_REGRESSION

#### Daily Metrics (`ops/metrics/YYYY-MM-DD.json`)
```json
{
  "date": "2026-01-28",
  "tasks_created": 4,
  "tasks_completed": 3,
  "tasks_overdue": 1,
  "completion_rate": 0.75,
  "avg_time_to_first_action_hours": 2.3,
  "incidents_count": 2,
  "incidents_by_type": {"WRONG_RECALL": 1, "TASK_STUCK": 1},
  "recall_pack_items_used": 7,
  "recall_pack_items_referenced_in_output": 4,
  "recall_hit_rate": 0.57,
  "escalations_triggered": 1
}
```

#### Nightly Improvement Loop (4 AM)
**Sub-agent spawned with label "nightly-improve"**

1. **Aggregate** — Read last 7 days of `ops/metrics/*.json`, identify trends
2. **Analyze incidents** — Cluster `ops/incidents.jsonl` by type, find top failure mode
3. **Propose patches** — Generate 1-3 specific, actionable improvements:
   - Prompt template change
   - New procedure in knowledge/
   - Recall trigger rule update
   - Escalation threshold adjustment
4. **Council review** — Spawn council session: "Review these proposed improvements. Approve, modify, or reject each one."
5. **Apply approved patches** — Write changes to files, save patch record to `ops/patches/applied/`
6. **Update experiments** — If testing a variant, record metrics for comparison

#### Patch File (`ops/patches/applied/PATCH-20260128-001.md`)
```markdown
# PATCH-20260128-001: Improve recall for client preferences

## Incident: WRONG_RECALL on 2026-01-27
Client X preference for net-15 payment terms was not surfaced during invoice task.

## Root Cause
Recall pack did not include entity-specific preferences when task mentions a client name.

## Fix Applied
Updated recall/triggers.json to auto-load entity file when task title mentions a known entity name.

## Council Verdict
- Grok: Approved ✅ — "Simple and effective"
- ChatGPT: Approved with modification ✅ — "Also add financial preferences to P0 recall"  
- Gemini: Approved ✅

## Rollback Condition
If recall_hit_rate drops below 0.50 for 3 consecutive days.

## Metrics to Watch
- recall_hit_rate (expect increase from 0.57 → 0.70+)
- incidents of type WRONG_RECALL (expect decrease)
```

#### Experiments Registry (`ops/experiments.json`)
```json
{
  "active": [
    {
      "id": "EXP-001",
      "name": "Recall Pack v2 — entity-aware triggers",
      "started": "2026-01-28",
      "hypothesis": "Loading entity files when task mentions known entity names will increase recall_hit_rate",
      "success_metric": "recall_hit_rate > 0.70 for 5 days",
      "guardrail": "incident_rate does not increase > 20%",
      "rollback_if": "recall_hit_rate < 0.50 for 3 days",
      "status": "active"
    }
  ],
  "completed": []
}
```

### 📅 CRON SCHEDULE

| Time | Job | What It Does |
|---|---|---|
| Every 30 min (8AM-10PM) | task-reconciler | Check all active tasks, enforce next_check, escalate |
| 3:00 AM | memory-consolidation | Extract events from daily log, update knowledge base, rebuild recall pack |
| 4:00 AM | nightly-improve | Aggregate metrics, analyze incidents, propose + council-review patches |
| 8:00 AM | daily-report | Generate accountability report, send to Telegram |
| 9:00 AM Mon | weekly-report | Weekly metrics summary + trend analysis |
| 11:00 PM | git-autocommit | EXISTING: backup workspace to GitHub |

### 🔄 THE VIRTUOUS CYCLE

```
Session Interaction
    → Memory events logged to ledger.jsonl
    → Tasks created/updated in tasks/active/
    → Task events logged to tasks/events.jsonl

Every 30 min: Reconciler
    → Catches stale/overdue tasks
    → Escalates appropriately
    → Logs incidents for stuck tasks

3 AM: Memory Consolidation  
    → Extracts structured events from daily log
    → Updates knowledge base (entities, procedures, etc.)
    → Regenerates recall pack for next session
    
4 AM: Nightly Improvement
    → Analyzes incidents and metrics
    → Proposes patches (new procedures, better recall rules)
    → Council reviews and approves/rejects
    → Applied patches improve tomorrow's performance

8 AM: Accountability Report
    → Surfaces everything to Francisco
    → Nothing is hidden, nothing is forgotten
    
Next Session:
    → Loads improved recall pack
    → Has better procedures from patches
    → Fewer incidents because of improvements
    → COMPOUND IMPROVEMENT
```

---

## 🎯 BUILD-IT-TODAY CHECKLIST (Priority Order)

### Phase 1: Foundation (This Week)
- [ ] Create `memory/ledger.jsonl` — start appending structured events at session end
- [ ] Create `tasks/` directory structure with `events.jsonl` and `active/` folder
- [ ] Define task JSON schema and start tracking tasks as individual files
- [ ] Create `recall/pack.md` — manually at first, then automate
- [ ] Update `HEARTBEAT.md` to include task reconciliation checks

### Phase 2: Automation (Next Week)  
- [ ] Create cron job: task-reconciler (every 30 min, sub-agent)
- [ ] Create cron job: memory-consolidation (3 AM, sub-agent)
- [ ] Create cron job: daily-report (8 AM, sub-agent)
- [ ] Create `ops/incidents.jsonl` and start logging failures

### Phase 3: Intelligence (Week 3)
- [ ] Create knowledge/ Second Brain directories
- [ ] Build nightly improvement loop (4 AM cron)
- [ ] Implement patch pipeline with council review
- [ ] Create experiments registry
- [ ] Build weekly metrics trends report

### Phase 4: Polish (Week 4)
- [ ] Add recall trigger rules (trigger-word detection)
- [ ] Implement dead-man switch for P0 tasks
- [ ] Add Definition of Done enforcement
- [ ] Tune escalation thresholds based on first month's data

---

## 📊 AGREEMENT MATRIX

| Feature | Grok | ChatGPT | Gemini | Final |
|---|---|---|---|---|
| Append-only event logs | R2 ✅ | R1 ✅ | R1 ✅ | ✅ **UNANIMOUS** |
| SQLite for indexing | R2 ✅ | R1 ✅ | R2 ✅ | ⏸️ **DEFERRED** (premature for our system) |
| Priority P0-P3 | R1 ✅ | R1 ✅ | R2 ✅ | ✅ **UNANIMOUS** |
| Nightly consolidation | R1 ✅ | R1 ✅ | R1 ✅ | ✅ **UNANIMOUS** |
| Proactive recall injection | R1 ✅ | R1 ✅ | R1 ✅ | ✅ **UNANIMOUS** |
| Council-gated patches | R2 ✅ | R2 ✅ | R1 ✅ | ✅ **UNANIMOUS** |
| Task reconciler | R1 ✅ | R1 ✅ | R1 ✅ | ✅ **UNANIMOUS** |
| Dead-man switch | R1 ✅ | R1 ✅ | R1 ✅ | ✅ **UNANIMOUS** |
| Incident logging | R2 ✅ | R1 ✅ | R2 ✅ | ✅ **UNANIMOUS** |
| Typed memory events | R2 ✅ | R1 ✅ | R1 ✅ | ✅ **UNANIMOUS** |
| Second Brain knowledge base | R2 ✅ | R2 ✅ | R1 ✅ | ✅ **UNANIMOUS** |
| 7-8 state task machine | R2 (7) | R1 (10) | R2 (7) | ✅ **8 states** |
| Vector embeddings | ❌ | ❌ | R2 ✅ | ❌ **KILLED** (zero budget) |
| External Python scripts | R1 ✅ | R1 ✅ | R1 ✅ | ❌ **REPLACED** with sub-agents |

---

*Session completed: 2026-01-28 ~3:30 AM EST*
*Duration: ~35 minutes across 2 rounds + synthesis*
*Cost: $0 (all existing subscriptions)*
*AIs consulted: Grok 4.1 Thinking, ChatGPT 5.2, Gemini CLI*
*Final verdict by: Claude Opus 4.5*
