# Council Session: Task Tracking System Architecture
**Date:** 2026-01-29
**Participants:** Grok, ChatGPT 5.2 (Gemini CLI timed out)

## Question
What is the BEST system architecture for a task tracking system for an AI assistant? The bot starts tasks but doesn't always finish them due to context truncation. Requirements: persistent task list, visible to human via web dashboard, separates Human/Bot/Queue tasks, human can reorder priorities, bot checks items off when done, bot reads list at session start, simple enough to work.

---

## 🤖 GROK says:

**Recommendation: JSON Task Queue (tasks.json) integrated with Mission Control Dashboard**

Key points:
- **Markdown:** Too unstructured for bot reliability. Parsing is error-prone (nested lists, malformed checkboxes). Reordering is manual cut-paste. Checkoffs by bot risk file conflicts.
- **JSONL append-only:** Excellent for auditing but struggles with mutability/reordering. Viewing active tasks requires filtering/aggregation overhead. Awkward for reordering (append priority events, sort on read).
- **Dashboard integration:** Powerful but might not be "simple enough" without significant development.
- **Database:** Overkill for chat-based system. Not aligned with current JSON/JSONL setup.

**Winner: JSON task queue** — simple, structured, mutable for needs, integrable with existing files/dashboard. No parsing pitfalls.

### Proposed File Structure:
```json
{
  "human_tasks": [
    {"id": "h1", "description": "...", "priority": 1, "status": "pending"}
  ],
  "bot_tasks": [...],
  "queue": [...],
  "last_updated": "2026-01-29T09:22:00Z"
}
```

### Workflow:
1. **Session Start:** Bot loads tasks.json, integrates with state.json
2. **Adding Tasks:** Bot appends to array, generates ID, logs to work-ledger.jsonl
3. **Bot Checkoffs:** Updates status in tasks.json, logs to events.jsonl
4. **Human Reorders:** Dashboard UI with drag-and-drop (Sortable.js), saves to JSON
5. **Conflict Prevention:** Use last_updated timestamp; bot checks if file changed since read
6. **Backup:** Version tasks.json periodically via events.jsonl reconstruction

---

## 🟢 CHATGPT says:

**Recommendation: Hybrid approach — Mutable Tasks Board + Append-only Events**

Key points:
- **Markdown:** Best for solo workflows where bot never writes. Concurrency conflicts common. You'll end up inventing a schema inside Markdown.
- **Mutable JSON alone:** No audit trail. Harder to debug "why did this happen."
- **JSONL alone:** Need materialized view for current tasks. Reordering = "emit event, rebuild view."
- **DB-backed dashboard:** More moving parts. If you overbuild, violates "simple enough to work."

**Winner: Single JSON "board" + append-only events.jsonl for audit**

### Why this is best:
- Board keeps it **simple and operational**
- Events log keeps it **explainable and recoverable**
- Avoid rebuilding state from logs on every request, but CAN rebuild if corruption happens

### Proposed File Structure:
```
/tasking/
  tasks.board.json    # current truth: lanes, ordering, task metadata
  events.jsonl        # append-only audit events
  work-ledger.jsonl   # optional commitments log
```

### Board Schema:
```json
{
  "version": 1,
  "updated_at": "2026-01-29T14:05:00Z",
  "lanes": {
    "queue": ["t_100", "t_101"],
    "bot": ["t_200"],
    "human": ["t_300"]
  },
  "tasks": {
    "t_100": {
      "title": "...",
      "lane": "queue",
      "status": "ready",
      "priority": 10,
      "owner": "bot",
      "tags": ["core"]
    }
  }
}
```

### Event Types:
- TASK_CREATED, TASK_UPDATED, TASK_MOVED, TASK_REORDERED, TASK_STATUS, TASK_DELETED

### Key Principle:
Every mutation to tasks.board.json must also append an event to events.jsonl.

---

## 💎 GEMINI says:
(Timed out - no response received)

---

## ✅ CONSENSUS (Both Agree):

1. **JSON is the right format** — not Markdown, not pure JSONL, not a database
2. **Single mutable file as source of truth** for current tasks
3. **Separate lanes/sections** for Human vs Bot vs Queue (first-class separation)
4. **Append-only audit log** (events.jsonl) for debugging/recovery
5. **Array order = priority order** (explicit, human-controllable)
6. **Bot reads file at session start** (critical for context truncation recovery)
7. **Dashboard integration via file reads/writes** (no need for API complexity)
8. **Keep existing events.jsonl** for auditability

## ⚡ UNIQUE INSIGHTS:

- **Grok:** Use `last_updated` timestamp for conflict detection; bot checks if file changed since read
- **ChatGPT:** Use `version` field + separate `lanes` object (task IDs only) for explicit ordering. Lanes array is the canonical order, not priority numbers.
- **ChatGPT:** Every mutation MUST append event (audit enforcement)

## ⚔️ DISAGREEMENTS:

| Topic | Grok | ChatGPT |
|-------|------|---------|
| **Ordering** | `priority` field as integer | Array position in `lanes` object |
| **File name** | `tasks.json` | `tasks.board.json` |
| **Structure** | Separate arrays per category | `lanes` object with task ID arrays + `tasks` object with task details |

---

## 🏆 SYNTHESIS — Best of Both

Take ChatGPT's architecture (cleaner separation of concerns) with Grok's simplicity:

### File: `memory/tasks.json`
```json
{
  "version": 1,
  "updated_at": "2026-01-29T14:30:00Z",
  "lanes": {
    "queue": ["t001", "t002"],
    "bot": ["t003"],
    "human": ["t004", "t005"]
  },
  "tasks": {
    "t001": {
      "title": "Fix SEO titles",
      "status": "pending",
      "created": "2026-01-29T09:00:00Z"
    },
    "t003": {
      "title": "Run PageSpeed audit",
      "status": "in_progress",
      "created": "2026-01-29T10:00:00Z"
    }
  }
}
```

### Workflow:
1. **Session start:** Bot reads `memory/tasks.json`, displays top items from each lane
2. **New task:** Add to `tasks` object + append ID to appropriate lane + append to `events.jsonl`
3. **Checkoff:** Update status in `tasks`, append event
4. **Human reorder:** Dashboard drag-drop changes array order in `lanes`, saves file
5. **Context truncation recovery:** Re-read `memory/tasks.json` — full state restored

### Why This Wins:
- **Simple:** One JSON file, standard file ops
- **Auditable:** events.jsonl has history
- **Human-friendly:** lanes arrays make reordering trivial in dashboard
- **Bot-friendly:** Easy to parse, no Markdown ambiguity
- **Recoverable:** Can rebuild from events if needed
