# 🧠 THE COUNCIL — Mission Control Upgrade
**Date:** 2026-01-29
**Question:** How to upgrade Mission Control so bot never forgets tasks?

---

## 📋 THE PROBLEM

Francisco's AI assistant forgets tasks when Telegram chat gets compressed. Needs:
1. Visual dashboard: Human tasks vs Bot tasks vs Queue vs Done
2. Each task has linked PLAN/procedure (clickable)
3. Bot reads task board at EVERY session start
4. Francisco can reorder priorities (drag OR chat command)
5. Cron/scheduled jobs visible in pipeline
6. Build on existing `mission-control/` and `memory/tasks.json`

---

## 🤖 GROK says:

**Architecture:** Lightweight, local monolithic Python app
- **Database:** SQLite (file-based, no server)
- **Backend:** Flask on localhost:5000 with RESTful API
- **Scheduler:** APScheduler (Python, native integration)
- **Frontend:** HTML/JS + Bootstrap with SortableJS for drag-drop
- **Key insight:** "Avoid overkill like microservices for a personal assistant"

**Schema:**
- `tasks` table: id, title, status, lane, priority_order (INTEGER), procedure_link, approach, timestamps
- `cron_jobs` table: id, name, schedule, task_id, last_run, next_run, status

**Bot Integration:**
- AI calls `GET /tasks/load` at session start
- Returns JSON of bot-relevant tasks (bot_current + bot_queue + scheduled)
- Procedures stored in `/procedures/` folder as MD or Python files

---

## 🟢 CHATGPT says:

**Architecture:** Durable, versioned state machine with cloud-ready components
- **Database:** Firestore (or Postgres) as canonical truth
- **Procedures:** Separate versioned collection with `procedure_id + version`
- **Task claiming:** Leased ownership with `worker_id + lease_expires_at`
- **Ordering:** LexoRank strings for efficient drag-drop inserts
- **Scheduler:** Cloud Scheduler mirrored to database for visibility
- **Frontend:** Next.js with real-time Firestore reads

**Key insight:** "Stop treating chat as the source of truth. Make the task board a durable, versioned state machine."

**Data model additions:**
- `claimed_by: { worker_id, lease_expires_at }` for concurrency
- `procedure_ref: { id, version }` for drift prevention
- `runs` collection for audit trail and truncation recovery
- `constraints` object for guardrails

---

## ✅ CONSENSUS (both agree):

1. **External persistence is mandatory** — Tasks MUST live in a database, not chat context
2. **API-first design** — Bot reads via API/file at session start
3. **Lanes for separation** — bot_current, bot_queue, human, scheduled, done_today
4. **Procedure linking** — Each task must reference a plan/procedure file
5. **Priority ordering** — Numeric or string-based ordering within lanes
6. **Cron visibility** — Scheduled jobs stored in database with next_run displayed

---

## ⚔️ DISAGREEMENTS:

| Topic | Grok | ChatGPT |
|-------|------|---------|
| **Database** | SQLite (simple, local) | Firestore/Postgres (scalable, cloud) |
| **Ordering** | INTEGER priority_order | LexoRank strings (no renumbering) |
| **Scheduler** | APScheduler (Python) | Cloud Scheduler + mirror |
| **Procedures** | File paths only | Versioned registry with ID + version |
| **Concurrency** | DB transactions | Lease-based claiming |
| **Frontend** | Bootstrap + vanilla JS | Next.js + real-time |

---

## 🏆 MY VERDICT

**RECOMMENDATION: Hybrid approach - keep JSON, add minimal API layer**

For Francisco's situation (single user, localhost, existing JSON system), I recommend:

### 1. KEEP `memory/tasks.json` as primary truth
- It's already working
- Bot already reads it at session start (AGENTS.md protocol)
- No database migration needed
- Human-readable, git-versioned

### 2. ADD a lightweight server for the dashboard
```
mission-control/
├── server.py          # Simple Flask/FastAPI serving dashboard
├── index.html          # Enhanced Kanban dashboard
├── data.json           # Already exists
└── tasks-sync.js       # Real-time sync with tasks.json
```

### 3. UPGRADE `tasks.json` structure
```json
{
  "tasks": {
    "T001": {
      "title": "...",
      "lane": "bot_queue",
      "status": "pending",
      "plan": "procedures/seo/README.md#section",
      "approach": "1. Open browser 2. Navigate...",
      "priority": 1,
      "created": "...",
      "updated": "..."
    }
  },
  "lanes": {
    "bot_current": ["T002"],
    "bot_queue": ["T003", "T004"],
    "human": ["T005", "T006"],
    "scheduled": ["CRON-research"],
    "done_today": ["T001"]
  }
}
```

### 4. Dashboard UX improvements
- **Split view:** Left = Bot lanes (Current + Queue), Right = Human lane
- **Clickable plans:** Each task shows plan link, opens procedure file
- **Drag-drop:** Reorder within lanes, moves update `lanes` arrays
- **Cron pipeline:** Visual timeline showing next 24h of scheduled jobs
- **Francisco commands:** "move T003 to position 1" works via chat

### 5. Bot reading workflow (MANDATORY)
```
Every session start:
1. Read memory/tasks.json
2. Display current task + queue to user
3. READ THE PLAN before starting any task
4. Update tasks.json when status changes
5. Log to events.jsonl for audit
```

---

## 📁 FILE STRUCTURE CHANGES

```
workspace/
├── memory/
│   ├── tasks.json              # ENHANCED with plan links
│   ├── state.json              # Current state (keep)
│   └── events.jsonl            # Audit log (keep)
├── procedures/                  # REQUIRED plan files
│   ├── seo/README.md
│   ├── product-listing.md
│   └── browser.md
├── mission-control/
│   ├── index.html              # UPGRADE with split view
│   ├── server.py               # NEW: serve + API endpoints
│   └── data.json               # Sync from tasks.json
└── AGENTS.md                    # Already has task board protocol ✅
```

---

## 🔄 WHAT FRANCISCO DOES

1. **View dashboard:** Open localhost:8765 (already running)
2. **Reorder:** Drag tasks OR say "put T003 at top of queue"
3. **Review plans:** Click plan link before bot executes
4. **Mark human tasks done:** Click done OR say "T005 is done"
5. **Add tasks:** Use dashboard form OR say "add task: [description]"

---

## 🤖 BOT WORKFLOW

```
SESSION START:
├── Read memory/tasks.json
├── Read procedures/ for current task
├── Report: "Working on T002. Queue: T003, T004"
└── Update state.json + events.jsonl

DURING WORK:
├── Follow procedure steps
├── Update tasks.json on completion
└── Move to done_today, pull next from queue

ON FRANCISCO COMMAND:
├── "reorder T004 to position 1" → update lanes array
├── "T005 done" → move to done_today
└── "add task: fix SEO" → create new task with plan template
```

---

## 🧾 WHY THIS APPROACH

1. **Minimizes change** — Already have working JSON + dashboard
2. **No new infrastructure** — No Firestore, no cloud, no complex setup
3. **Git-friendly** — JSON files track in version control
4. **Matches Francisco's workflow** — Chat commands + visual dashboard
5. **Plans are clickable** — Links to procedure/ folder work in dashboard
6. **Bot never forgets** — tasks.json read is MANDATORY in AGENTS.md

---

## ⚠️ WHAT OVERKILL TO SKIP

- ❌ LexoRank (simple array reordering is fine for <50 tasks)
- ❌ Procedure versioning (git handles this)
- ❌ Lease-based claiming (single bot, no concurrency)
- ❌ Cloud Scheduler (APScheduler or existing cron works)
- ❌ Firestore (SQLite or JSON is sufficient)

---

## 📊 IMPLEMENTATION PRIORITY

1. **P0 (Today):** Ensure bot reads `tasks.json` at EVERY session start ✅ DONE
2. **P1 (This week):** Add `plan` field to all bot tasks
3. **P2 (This week):** Upgrade dashboard with split lanes view
4. **P3 (Next week):** Add drag-drop reordering
5. **P4 (Optional):** Add cron pipeline visualization

---

*Council session complete. Grade: B+ → Ready for implementation.*
