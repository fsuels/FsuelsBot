# 🧠 THE COUNCIL — Metrics Dashboard Design

**Date:** 2026-01-29  
**Rounds:** 2 (Quick session)  
**Topic:** A+ Requirement #5 - Metrics Dashboard for AI Agent Reliability

---

## 📋 QUESTION

Design a metrics dashboard for an AI agent system. Context: We just built:
1. Preflight gates (verify fresh instructions before SHIP)
2. Mid-session checkpoints (save task progress every heartbeat)
3. Overnight eligibility YAML (safe autonomous work definitions)
4. SQLite learnings.db (6 kinds, deduplication, confidence, pruning)

**Questions:**
1. What specific metrics should we track for A+ grade?
2. Where should metrics be stored? (SQLite? JSON? learnings.db extension?)
3. How do we collect metrics automatically?
4. What should the dashboard display?
5. Minimal viable implementation (done TODAY)?

---

## 🤖 GROK SAYS:

**Comprehensive response with 5 categories of metrics:**

### Metrics to Track:

**1. Preflight Gate Metrics:**
- Pass Rate (% instructions that pass verification, target 95%+)
- Failure Count by Type (invalid format, security risks, etc.)
- Latency (time to verify, in seconds)

**2. Mid-Session Checkpoint Metrics:**
- Save Success Rate (% checkpoints saved successfully)
- Failure Count (I/O errors, etc.)
- Frequency (checkpoints per session)

**3. Overnight Eligibility YAML Metrics:**
- Processing Success Rate (% YAML files processed without errors)
- Eligibility Approval Rate (% tasks deemed eligible)
- Error Count by type (syntax errors, etc.)

**4. SQLite Learnings.db Metrics:**
- Query Success Rate (% DB operations that succeed)
- Error Count by Operation (constraint violations, connection failures)
- Latency (avg time for DB operations)

**5. Overall System Metrics:**
- Task Completion Rate (% tasks completed without interruption)
- Total Error Rate (errors per 100 operations across all components)
- Uptime (% time agent is operational)

### Storage Recommendation:
**Extend existing SQLite learnings.db** — create new `metrics_log` table:
```sql
CREATE TABLE metrics_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT,           -- ISO format
    component TEXT,           -- 'preflight', 'checkpoint', etc.
    metric_name TEXT,         -- 'pass_rate', 'latency', etc.
    value REAL,               -- numeric value
    error_type TEXT           -- optional, for failures
);
```

### Auto-Collection:
- Use Python's built-in `sqlite3` (no installs needed)
- Create `log_metric(component, metric_name, value, error_type=None)` function
- Wrap key operations in try-except blocks
- Call at event points: after preflight, during checkpoints, around DB calls
- Use `time.time()` for timestamps and latencies

### Dashboard Display:
- **Summary cards:** Key KPIs (Task Completion Rate, Total Errors Last 24h)
- **Line charts:** Trends over time (pass rates by day)
- **Bar charts:** Error breakdowns by component/type
- **Tables:** Recent logs (last 50 entries) with filters
- **Alerts:** Highlight if any metric < threshold (red if error rate > 5%)

---

## 💎 GEMINI SAYS:

*(Gemini CLI unavailable - rate limited)*

---

## 🟢 CHATGPT SAYS:

*(Session timeout - proceeding with Grok + Claude synthesis)*

---

## ✅ CONSENSUS (Grok + Claude Analysis):

1. **Extend learnings.db** — don't create separate storage
2. **Track rates, not just counts** — percentages are more actionable
3. **Component-level granularity** — know WHERE problems occur
4. **Auto-collection via code hooks** — no manual tracking

---

## ⚡ UNIQUE INSIGHTS:

**Grok:** Track "rework" implicitly via retry_count in tasks + checkpoint frequency. High checkpoint frequency = long task = potential problem.

**Claude (my addition):** 
- **Recall Precision** — track `last_accessed_at` in learnings.db. If learnings aren't being accessed, they're not being used.
- **Context Truncation Recovery Rate** — how often does bot correctly resume from active-thread.md vs. restart from step 0?

---

## 🏆 MY VERDICT: Minimal Viable Implementation

### Schema Addition (to learnings.db):
```sql
CREATE TABLE IF NOT EXISTS metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL DEFAULT (datetime('now')),
    component TEXT NOT NULL,  -- 'preflight', 'checkpoint', 'eligibility', 'learnings', 'task'
    event TEXT NOT NULL,      -- 'pass', 'fail', 'save', 'query', 'complete', 'retry'
    value REAL,               -- latency_ms, count, rate
    details TEXT,             -- JSON blob for extra context
    session_id TEXT           -- link to session if relevant
);

CREATE INDEX idx_metrics_ts ON metrics(ts);
CREATE INDEX idx_metrics_component ON metrics(component);
```

### Collection Points (4 hooks TODAY):
1. **Preflight gate** — log pass/fail + latency after each check
2. **Checkpoint save** — log success/fail after each state.json write
3. **Task completion** — log when task moves to done_today
4. **Session start** — log if context truncation detected (active-thread.md recovery triggered)

### Dashboard Addition to Mission Control:
Add a "📊 Metrics" section to existing index.html:
- **Today's Stats:** Tasks completed, Checkpoints saved, Preflight passes
- **Last 7 Days Trend:** Simple line chart (use Chart.js from CDN)
- **Recent Events:** Last 20 metrics with component badges

### Implementation Steps (2-3 hours):
1. Add metrics table to learnings.db
2. Create `memory/metrics.py` with `log_metric()` function
3. Add 4 collection hooks to existing code
4. Add metrics section to Mission Control HTML
5. Test with a few manual events

### What NOT to Build Today:
- Real-time streaming (overkill)
- Complex aggregation (start simple)
- Alerts/notifications (add later if needed)
- Historical comparisons (need data first)

---

## 🧾 WHY THIS APPROACH:

**Storage in learnings.db:** Same database = simpler ops, easier backup, already have infrastructure. JSON would require separate read/write logic.

**Simple event logging over pre-computed rates:** Store raw events, calculate rates in dashboard query. More flexible, less code.

**Mission Control integration:** Already exists, already working. Don't build a new system.

**4 hooks, not 15:** Pareto principle. These 4 capture the most important reliability signals. Add more later based on what we learn.

---

## 📋 IMPLEMENTATION CHECKLIST:

- [ ] Create metrics table in learnings.db
- [ ] Write metrics.py with log_metric() function  
- [ ] Hook into preflight-check.ps1 (or wrapper)
- [ ] Hook into checkpoint save logic
- [ ] Hook into task completion
- [ ] Hook into session start (truncation detection)
- [ ] Add metrics section to Mission Control HTML
- [ ] Verify with test events

---

**Grade potential:** This gets us to A. Full A+ would need recall precision tracking and trend analysis, but that can wait until we have data.
