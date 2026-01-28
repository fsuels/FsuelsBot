# Memory System Architecture
*Master procedure document — how memory works in this system*
*Created: 2026-01-28 | Source: Council session 2026-01-28*

## Overview

The memory system has 4 layers, each serving a different purpose:

| Layer | File(s) | Purpose | Mutability |
|-------|---------|---------|------------|
| 1. Raw Capture | `memory/YYYY-MM-DD.md` | Daily session logs | Append-only per day |
| 2. Event Ledger | `memory/ledger.jsonl` | Structured, searchable events | **Append-only, NEVER edited** |
| 3. Knowledge Base | `knowledge/` | Curated, canonical knowledge | Updated by consolidation |
| 4. Recall Pack | `recall/pack.md` | Session context injection | Regenerated daily + on-demand |

**Information flows DOWN:** Raw logs → extracted into ledger → consolidated into knowledge → surfaced in recall pack.

**The ledger is the source of truth.** Knowledge files are derived views. If they contradict the ledger, the ledger wins.

---

## Layer 1: Raw Capture (`memory/YYYY-MM-DD.md`)

**What:** Freeform daily logs written during sessions. Everything noteworthy goes here.

**Rules:**
- One file per day, named `YYYY-MM-DD.md`
- Append-only within the day (don't delete earlier entries)
- Include timestamps for significant events
- At end of each session, add a `## Priority Extracts` section:

```markdown
## Priority Extracts
- [P0] Client X deadline moved to Feb 15
- [P1] Decided on tiered pricing model
- [P2] User prefers bullet points over paragraphs
```

**This is what we already do.** No changes needed to daily logging.

---

## Layer 2: Event Ledger (`memory/ledger.jsonl`)

**What:** Append-only JSONL file. One structured event per line. NEVER edited or deleted.

**This is the most important file in the system.** It's the immutable record of everything that matters.

### Event Schema

```json
{
  "ts": "2026-01-28T14:03:11-05:00",
  "id": "EVT-20260128-001",
  "type": "commitment",
  "priority": "P0",
  "content": "Follow up Client X by Feb 1",
  "entity": "client_x",
  "tags": ["sales", "deadline"],
  "source": "memory/2026-01-28.md",
  "session": "main"
}
```

### Fields

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `ts` | Yes | ISO 8601 | When this was recorded |
| `id` | Yes | String | Unique ID: `EVT-YYYYMMDD-NNN` |
| `type` | Yes | Enum | See Event Types below |
| `priority` | Yes | Enum | P0, P1, P2, or P3 |
| `content` | Yes | String | Human-readable description |
| `entity` | No | String | Primary entity (snake_case) |
| `tags` | No | Array | Categorization tags |
| `source` | Yes | String | Where this info came from (`"live"` for real-time extraction) |
| `session` | No | String | Session identifier |
| `related` | No | Array | IDs of related events (Memory Chains) |
| `supersedes` | No | String | ID of event this corrects/replaces (Supersession Protocol) |
| `status` | No | String | For commitments: `"open"` or `"closed"` (Open Loops) |

### Event Types

| Type | Description | Example |
|------|-------------|---------|
| `fact` | A piece of information | "Francisco's birthday is March 11, 1981" |
| `decision` | A choice that was made | "Focus 100% on DLM profitability first" |
| `preference` | User preference or style | "Prefers open source tools over proprietary" |
| `commitment` | Something promised or owed | "Follow up with BuckyDrop support by Jan 30" |
| `constraint` | A limitation or rule | "$0 extra budget for any new tools" |
| `procedure` | How something should be done | "WhatsApp: draft in Telegram, Francisco copies" |
| `relationship` | Connection between entities | "Scott is BuckyDrop support contact" |
| `insight` | Learned pattern or wisdom | "Large sessions >118K tokens cause crashes" |
| `milestone` | Something achieved | "Published 10 blog posts on DLM" |
| `conflict` | Contradiction needing resolution | "GMC says logos rejected, but we uploaded new ones" |

### Priority Levels

| Priority | Retention | Description | Examples |
|----------|-----------|-------------|----------|
| P0 | **PERMANENT** | Core identity, security, critical rules | Budget constraint, security rules, core directives |
| P1 | **INDEFINITE** | Important business info, key relationships | Business decisions, project status, account IDs |
| P2 | Archive 90 days | Session context, minor preferences | Tool tips, formatting preferences |
| P3 | Archive 30 days | Ephemeral, one-time events | Temp tasks, transient status updates |

### Rules

1. **NEVER edit or delete lines** from ledger.jsonl
2. **To correct info:** Append a NEW event with `"supersedes": "EVT-XXX"` — old event stays but stops being surfaced
3. **IDs are sequential per day:** EVT-20260128-001, EVT-20260128-002, etc.
4. **Always include source:** Where did you learn this? Use `"live"` for real-time extraction during conversations
5. **Memory Chains:** When writing an event related to previous events, add `"related": ["EVT-XXX", "EVT-YYY"]`
6. **Open Loops:** Commitment events should include `"status": "open"`. When fulfilled, append a closing event with `"status": "closed"`

---

## Layer 3: Knowledge Base (`knowledge/`)

**What:** Curated, structured markdown files organized by category. Think of it as a wiki.

### Directory Structure

```
knowledge/
├── entities/          # People, companies, projects, accounts
├── procedures/        # How-to guides for the AI
├── principles/        # Standing rules, preferences, constraints
└── insights/          # Learned patterns, wisdom, technical lessons
```

### Entity Files (`knowledge/entities/`)

One file per important entity. Canonical reference for everything known about it.

**Naming:** `entity-name.md` (kebab-case)

**Template:**
```markdown
# Entity Name
*Type: person | company | project | account | tool*
*Last updated: YYYY-MM-DD*

## Summary
One paragraph overview.

## Key Facts
- Fact 1 [source: memory/YYYY-MM-DD.md] [verified: YYYY-MM-DD]
- Fact 2 [source: ...] [verified: ...]

## Relationships
- Related to: [other entity] — [relationship description]

## Active Context
[Anything currently relevant — open tasks, recent changes, pending items]

## History
[Timeline of significant events]
```

### Procedure Files (`knowledge/procedures/`)

How-to guides that tell the AI how to do things.

**Template:**
```markdown
# Procedure: [Name]
*Last updated: YYYY-MM-DD*
*Source: [where this procedure was established]*

## When to Use
[Trigger conditions]

## Steps
1. Step one
2. Step two
3. ...

## Notes
[Edge cases, common mistakes, tips]
```

### Principle Files (`knowledge/principles/`)

Standing rules that should always be followed.

**Template:**
```markdown
# Principle: [Name]
*Priority: P0/P1*
*Established: YYYY-MM-DD*
*Source: [who established this and why]*

## Rule
[Clear statement of the rule]

## Rationale
[Why this rule exists]

## Exceptions
[When this rule can be bent or broken]
```

### Insight Files (`knowledge/insights/`)

Patterns, lessons, and wisdom learned from experience.

**Template:**
```markdown
# Insight: [Name]
*Learned: YYYY-MM-DD*
*Source: [how we learned this]*

## The Insight
[What we learned]

## Evidence
[What happened that taught us this]

## Application
[How to use this knowledge going forward]
```

### Update Rules

1. Knowledge files ARE mutable — they represent current understanding
2. Always note `[verified: YYYY-MM-DD]` on facts
3. When updating, note what changed and why at the bottom
4. Consolidation sub-agent updates these nightly
5. Can also be updated manually during sessions when new info emerges

### Confidence Decay

Facts age. Old facts become unreliable. The system tracks freshness automatically.

**Rules:**
- Every fact in a knowledge file MUST have `[verified: YYYY-MM-DD]`
- During nightly consolidation, check age of all verified facts:
  - **< 30 days:** Fresh ✅ — include in recall pack normally
  - **30-60 days:** Aging ⚠️ — flag `[⚠️ STALE]` in recall pack
  - **> 60 days:** Stale ❌ — drop from recall pack unless explicitly relevant to today's tasks
- **What decays:** Facts, account statuses, platform states, business metrics
- **What does NOT decay:** Preferences, principles, identities, relationships, procedures
- Stale facts are NOT deleted — they stay in knowledge files, just aren't surfaced
- Re-verification: when a fact is confirmed current, update its `[verified: date]`

---

## Layer 4: Recall Pack (Delta Architecture)

**What:** A curated, compact document loaded at session start. Contains EXACTLY what the AI needs to know.

**This is the most important innovation.** Instead of loading all files (too much) or nothing (too little), we load a carefully curated summary of what matters RIGHT NOW.

### Delta Architecture (Split Design)

The recall pack uses a **core + delta** split for efficiency:

| File | Content | Changes |
|------|---------|---------|
| `recall/core.md` | Identity, P0 constraints, mantra, procedures, account IDs | Rarely (only on new P0 constraints) |
| `recall/delta.md` | Open commitments, waiting-on, today's focus, active context | Nightly (by consolidation) |
| `recall/pack.md` | Combined view (core + delta) | Nightly (auto-generated) |

**Why split?** Consolidation only rebuilds the delta. The core is stable — rewriting it every night wastes work. This is "more with less."

**Session startup reads `recall/pack.md`** (the combined view). One file, all context.

### Pack Format

```markdown
# Recall Pack — YYYY-MM-DD
<!-- CORE section: P0 constraints, mantra, procedures, account IDs -->
<!-- DELTA section: open commitments, waiting-on, focus, context -->
```

### Open Loops (Commitment Tracking)

Commitment-type events in the ledger have a `"status"` field: `"open"` or `"closed"`.
- The delta pack ALWAYS surfaces the **top 3 oldest open commitments**
- When a commitment is fulfilled, append a new event with `"status": "closed"`
- This prevents things from falling through the cracks

### Supersession Protocol

When a new fact contradicts an old one:
- The new event includes `"supersedes": "EVT-XXX"` pointing to the old event ID
- The recall pack builder automatically **excludes superseded events**
- The old event stays in the ledger (never deleted) but stops being surfaced
- This is **memory self-cleaning** — the system corrects itself

### Generation Rules

1. **Regenerated at 3 AM daily** by consolidation sub-agent
2. **Can be regenerated on-demand** during sessions if context changes
3. **Must stay under 3,000 words** — brevity is essential
4. **P0 section is ALWAYS included** regardless of length
5. **Prioritize recency** — last 48h > last week > last month
6. **Include entity context** for any entity likely to come up today

### Trigger-Based Expansion (`recall/triggers.json`)

When certain words appear in user input, load additional knowledge files:

```json
{
  "triggers": [
    {
      "patterns": ["shopify", "store", "products", "DLM", "dress like mommy"],
      "load": ["knowledge/entities/dress-like-mommy.md"]
    },
    {
      "patterns": ["buckydrop", "supplier", "shipping", "orders"],
      "load": ["knowledge/entities/buckydrop.md"]
    },
    {
      "patterns": ["budget", "cost", "price", "spend", "pay"],
      "load": ["knowledge/principles/budget-rules.md"]
    }
  ]
}
```

**Note:** Trigger-based loading is a future enhancement. For now, the recall pack itself provides sufficient context. Triggers will be implemented when we have enough knowledge files to justify dynamic loading.

---

## Live Extraction (During Sessions)

**Don't wait for consolidation.** When something important happens during a conversation, append it to the ledger immediately:

1. Identify the event (decision, commitment, fact, insight, etc.)
2. Determine priority (P0-P3)
3. Get the next sequential ID for today (`EVT-YYYYMMDD-NNN`)
4. Append the JSON line to `memory/ledger.jsonl`

**When to live-extract:**
- Francisco makes a decision → log it NOW
- A commitment is made → log it NOW
- A new P0 constraint is established → log it NOW
- A significant milestone is reached → log it NOW
- An important fact is discovered → log it NOW

**When to leave for consolidation:**
- Routine session events (P2/P3)
- Information already captured in the daily log
- Minor updates that don't need immediate recall

Live extraction means the ledger stays current. The 3 AM consolidation catches anything missed and rebuilds the recall pack.

---

## Consolidation Process

### When: 3 AM daily (cron-spawned sub-agent)

### Steps:

1. **Read** today's `memory/YYYY-MM-DD.md`
2. **Extract** structured events → append to `memory/ledger.jsonl`
   - Identify facts, decisions, preferences, commitments, constraints, procedures, insights
   - Assign priority P0-P3
   - Tag with relevant entities and categories
3. **Update knowledge base**
   - New entities → create file in `knowledge/entities/`
   - New info about existing entities → update their file
   - New procedures → create in `knowledge/procedures/`
   - New principles/rules → create in `knowledge/principles/`
   - New insights → create in `knowledge/insights/`
4. **Regenerate recall pack** → rewrite `recall/pack.md`
   - Scan ledger for open commitments (type: commitment, no corresponding milestone)
   - Scan for P0 constraints
   - Check for upcoming deadlines
   - Summarize current project status
5. **Report** → write `knowledge/consolidation-reports/YYYY-MM-DD.md`
   - How many events extracted
   - What knowledge files were created/updated
   - Any conflicts detected

### Pruning (quarterly)

- P2 events older than 90 days → move to `memory/archive/`
- P3 events older than 30 days → move to `memory/archive/`
- P0 and P1 events are NEVER pruned

---

## Session Startup Procedure

At the start of every session:

1. Read `SOUL.md` (identity)
2. Read `USER.md` (human)
3. Read `recall/pack.md` (**the key step** — this replaces reading raw memory files)
4. Read today's `memory/YYYY-MM-DD.md` (if exists — for today's raw context)
5. Read yesterday's `memory/YYYY-MM-DD.md` (for continuity)

The recall pack provides the curated context. Daily files provide raw recent context. Together, they give the AI everything it needs without overloading the context window.

**In main sessions only:** Also read `MEMORY.md` (until it's fully replaced by the recall pack + knowledge base system).

---

## Migration from Current System

This system EVOLVES from what we have. Nothing is destroyed.

| Current | New | Action |
|---------|-----|--------|
| `memory/*.md` daily files | Same | Keep as-is (Layer 1) |
| `MEMORY.md` | Kept, becomes secondary | Keep but recall pack takes priority |
| `second-brain/` | `knowledge/` + `second-brain/` | New knowledge/ is structured; second-brain/ remains as "inbox" |
| No event ledger | `memory/ledger.jsonl` | Created with backfill |
| No recall pack | `recall/pack.md` | Generated from current state |
| No consolidation | 3 AM cron sub-agent | New cron job |
| heartbeat-state.json | Same | Keep as-is |

---

## Key Design Decisions

1. **Files Claude can read/write natively** — markdown + JSON + JSONL. No databases.
2. **Append-only ledger** — immutability prevents data loss.
3. **Sub-agents for maintenance** — Claude IS the processor, no external scripts needed.
4. **Evolve, don't replace** — existing files stay. New system layers on top.
5. **Recall pack solves context window** — curated 3K words beats random 50K words.
6. **Priority system drives retention** — P0 permanent, P3 ephemeral.

*This document is the canonical reference for how memory works. When in doubt, follow this.*
