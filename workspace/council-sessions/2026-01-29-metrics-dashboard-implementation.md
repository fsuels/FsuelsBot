# Council Session: Implementation Blueprint — Aggregated Observability (Metrics Dashboard)

**Date:** 2026-01-29
**Goal:** Design metrics collection and dashboard for system observability
**Session Type:** Implementation Blueprint (Single-round synthesis due to browser automation issues)

---

## CONTEXT — OUR CURRENT SYSTEM

**Existing Infrastructure (Verified):**
```
learnings.db (memory/learnings.db):
├── learning table: facts/decisions/preferences/constraints/procedures/insights
├── canonical_hash for deduplication
├── confidence scoring (0.0-1.0)
├── is_pinned for P0 protection
└── active_learnings & learnings_to_review views

Mission Control (mission-control/activity-server.py):
├── Python HTTP server on port 8765
├── Serves dashboard HTML + APIs
├── /api/activity — real-time session events
├── /api/health — system health check
├── /api/memory — memory system integrity
├── /api/tasks — tasks.json content
└── /api/status — online/offline status

Collection Points (existing):
├── preflight-check.ps1 — logs to events.jsonl with EVT-YYYYMMDD-NNN format
├── mid-session-checkpoint.ps1 — (exists but needs metrics hook)
├── tasks.json mutations — logged to events.jsonl
└── truncation recovery — active-thread.md loads (needs tracking)
```

**Current Gaps:**
- No aggregated metrics table
- No trend visualization
- No threshold-based alerting
- Can't detect systemic patterns (e.g., "preflight failing 30% of the time")

---

## IMPLEMENTATION DESIGN

### 1. METRICS SCHEMA (SQLite)

**Design Principle:** Simple time-series with flexible metric_name. No over-engineering.

```sql
-- Add to learnings.db initialization script (scripts/init-learnings-db.py)

CREATE TABLE IF NOT EXISTS metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    
    -- What and when
    metric_name TEXT NOT NULL,          -- e.g., 'preflight_pass', 'checkpoint_success', 'task_complete'
    metric_value REAL DEFAULT 1.0,      -- 1=success, 0=failure, or numeric count
    
    -- Context
    session_id TEXT,                    -- Link to specific session if applicable
    task_id TEXT,                       -- e.g., 'T004' if task-related
    details TEXT,                       -- JSON blob for additional context
    
    -- Timestamps
    recorded_at TEXT DEFAULT (datetime('now')),
    recorded_date TEXT DEFAULT (date('now'))  -- For easy daily rollups
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_metrics_name ON metrics(metric_name);
CREATE INDEX IF NOT EXISTS idx_metrics_date ON metrics(recorded_date);
CREATE INDEX IF NOT EXISTS idx_metrics_name_date ON metrics(metric_name, recorded_date);

-- View for today's summary
CREATE VIEW IF NOT EXISTS metrics_today AS
SELECT 
    metric_name,
    COUNT(*) as total_count,
    SUM(metric_value) as success_count,
    ROUND(SUM(metric_value) * 100.0 / COUNT(*), 1) as success_rate
FROM metrics
WHERE recorded_date = date('now')
GROUP BY metric_name;

-- View for 7-day trends
CREATE VIEW IF NOT EXISTS metrics_7day AS
SELECT 
    metric_name,
    recorded_date,
    COUNT(*) as total_count,
    SUM(metric_value) as success_count,
    ROUND(SUM(metric_value) * 100.0 / COUNT(*), 1) as success_rate
FROM metrics
WHERE recorded_date >= date('now', '-7 days')
GROUP BY metric_name, recorded_date
ORDER BY metric_name, recorded_date;
```

**Metric Names (Standardized):**
- `preflight_pass` — Value: 1 (pass) or 0 (fail)
- `checkpoint_success` — Value: 1 (saved) or 0 (failed)
- `task_complete` — Value: 1 (completed)
- `task_retry` — Value: retry_count (numeric)
- `truncation_recovery` — Value: 1 (each recovery event)
- `session_start` — Value: 1 (each session)
- `learning_added` — Value: 1 (each learning recorded)

---

### 2. COLLECTION HOOKS (Python Module)

**File:** `scripts/metrics.py`

```python
#!/usr/bin/env python3
"""
metrics.py
Record metrics to learnings.db for observability dashboard
Council A+ requirement: Aggregated Observability
"""

import sqlite3
import json
from datetime import datetime
from pathlib import Path

WORKSPACE = Path(r"C:\dev\FsuelsBot\workspace")
DB_PATH = WORKSPACE / "memory" / "learnings.db"

def record_metric(metric_name: str, value: float = 1.0, 
                  session_id: str = None, task_id: str = None, 
                  details: dict = None):
    """Record a single metric event."""
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    
    details_json = json.dumps(details) if details else None
    
    cur.execute("""
        INSERT INTO metrics (metric_name, metric_value, session_id, task_id, details)
        VALUES (?, ?, ?, ?, ?)
    """, (metric_name, value, session_id, task_id, details_json))
    
    conn.commit()
    conn.close()

def record_preflight(passed: bool, digest: dict = None, errors: list = None):
    """Record preflight check result."""
    record_metric(
        metric_name='preflight_pass',
        value=1.0 if passed else 0.0,
        details={
            'digest': digest,
            'errors': errors or []
        }
    )

def record_checkpoint(success: bool, task_id: str = None, step: str = None):
    """Record checkpoint save result."""
    record_metric(
        metric_name='checkpoint_success',
        value=1.0 if success else 0.0,
        task_id=task_id,
        details={'step': step}
    )

def record_task_complete(task_id: str, retry_count: int = 0):
    """Record task completion."""
    record_metric(
        metric_name='task_complete',
        value=1.0,
        task_id=task_id,
        details={'retry_count': retry_count}
    )
    
    if retry_count > 0:
        record_metric(
            metric_name='task_retry',
            value=float(retry_count),
            task_id=task_id
        )

def record_truncation_recovery(task_id: str = None, recovered_from: str = None):
    """Record truncation recovery event."""
    record_metric(
        metric_name='truncation_recovery',
        value=1.0,
        task_id=task_id,
        details={'recovered_from': recovered_from}
    )

def record_session_start(session_id: str, model: str = None):
    """Record new session start."""
    record_metric(
        metric_name='session_start',
        value=1.0,
        session_id=session_id,
        details={'model': model}
    )

def get_today_summary() -> dict:
    """Get today's metrics summary."""
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    
    cur.execute("SELECT * FROM metrics_today")
    columns = [d[0] for d in cur.description]
    rows = cur.fetchall()
    conn.close()
    
    return {row[0]: dict(zip(columns[1:], row[1:])) for row in rows}

def get_7day_trends() -> dict:
    """Get 7-day trends by metric."""
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    
    cur.execute("SELECT * FROM metrics_7day")
    rows = cur.fetchall()
    conn.close()
    
    # Group by metric_name
    trends = {}
    for row in rows:
        metric_name, date, total, success, rate = row
        if metric_name not in trends:
            trends[metric_name] = {'dates': [], 'rates': [], 'counts': []}
        trends[metric_name]['dates'].append(date)
        trends[metric_name]['rates'].append(rate)
        trends[metric_name]['counts'].append(total)
    
    return trends

def check_alerts() -> list:
    """Check for alert conditions. Returns list of alert messages."""
    alerts = []
    summary = get_today_summary()
    
    # Alert: Preflight failing > 20%
    if 'preflight_pass' in summary:
        rate = summary['preflight_pass'].get('success_rate', 100)
        if rate < 80:
            alerts.append(f"⚠️ Preflight pass rate low: {rate}% (threshold: 80%)")
    
    # Alert: High retry count (> 3 retries on any task)
    if 'task_retry' in summary:
        count = summary['task_retry'].get('total_count', 0)
        if count > 3:
            alerts.append(f"⚠️ High retry count today: {count} retries")
    
    # Alert: Truncation recovery (any occurrence is notable)
    if 'truncation_recovery' in summary:
        count = summary['truncation_recovery'].get('total_count', 0)
        if count > 0:
            alerts.append(f"⚠️ Truncation recovery events: {count}")
    
    # Alert: Checkpoint failures
    if 'checkpoint_success' in summary:
        rate = summary['checkpoint_success'].get('success_rate', 100)
        if rate < 95:
            alerts.append(f"⚠️ Checkpoint success rate low: {rate}% (threshold: 95%)")
    
    return alerts

# CLI interface
if __name__ == "__main__":
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: python metrics.py [today|trends|alerts|record <name> <value>]")
        sys.exit(1)
    
    cmd = sys.argv[1]
    
    if cmd == "today":
        summary = get_today_summary()
        print("=== Today's Metrics ===")
        for metric, data in summary.items():
            print(f"{metric}: {data}")
    
    elif cmd == "trends":
        trends = get_7day_trends()
        print("=== 7-Day Trends ===")
        for metric, data in trends.items():
            print(f"\n{metric}:")
            for i, date in enumerate(data['dates']):
                print(f"  {date}: {data['rates'][i]}% ({data['counts'][i]} events)")
    
    elif cmd == "alerts":
        alerts = check_alerts()
        if alerts:
            print("=== ALERTS ===")
            for alert in alerts:
                print(alert)
        else:
            print("✅ No alerts")
    
    elif cmd == "record" and len(sys.argv) >= 4:
        record_metric(sys.argv[2], float(sys.argv[3]))
        print(f"Recorded: {sys.argv[2]} = {sys.argv[3]}")
    
    else:
        print("Unknown command")
```

---

### 3. INTEGRATION WITH EXISTING SCRIPTS

**Update `preflight-check.ps1`:**

Add at the end (after logging to events.jsonl):

```powershell
# Record to metrics table
$metricValue = if ($results.status -eq "pass") { 1 } else { 0 }
$digestJson = ($results.digest | ConvertTo-Json -Compress) -replace '"', '\"'
$errorsJson = ($results.errors | ConvertTo-Json -Compress) -replace '"', '\"'

python "$workspace\scripts\metrics.py" record preflight_pass $metricValue
Write-Host "Metric recorded: preflight_pass = $metricValue" -ForegroundColor Gray
```

**Or simpler - call Python directly:**

```powershell
# At end of preflight-check.ps1
$pythonCmd = @"
import sys; sys.path.insert(0, r'C:\dev\FsuelsBot\workspace\scripts')
from metrics import record_preflight
record_preflight($($results.status -eq 'pass' ? '$true' : '$false'), $($results.digest | ConvertTo-Json -Compress))
"@
python -c $pythonCmd
```

---

### 4. MISSION CONTROL API ENDPOINT

**Add to `activity-server.py`:**

```python
# Add import at top
sys.path.insert(0, os.path.join(WORKSPACE_DIR, 'scripts'))
from metrics import get_today_summary, get_7day_trends, check_alerts

# Add new endpoint in do_GET method:

if path == '/api/metrics':
    self.send_response(200)
    self.send_header('Content-Type', 'application/json; charset=utf-8')
    self.send_header('Access-Control-Allow-Origin', '*')
    self.send_header('Cache-Control', 'no-cache')
    self.end_headers()
    
    try:
        response = {
            'today': get_today_summary(),
            'trends': get_7day_trends(),
            'alerts': check_alerts(),
            'generatedAt': datetime.now(timezone.utc).isoformat()
        }
        self.wfile.write(json.dumps(response, indent=2, ensure_ascii=False).encode('utf-8'))
    except Exception as e:
        self.wfile.write(json.dumps({'error': str(e)}).encode('utf-8'))
    return
```

---

### 5. DASHBOARD HTML (Chart.js Integration)

**Add to Mission Control `index.html` (new section):**

```html
<!-- Metrics Dashboard Section -->
<section id="metrics-dashboard" class="dashboard-section">
    <h2>📊 System Metrics</h2>
    
    <!-- Alerts Banner -->
    <div id="alerts-banner" class="alerts-banner" style="display:none;"></div>
    
    <!-- Today's Stats -->
    <div class="metrics-today">
        <h3>Today</h3>
        <div class="stat-cards">
            <div class="stat-card" id="preflight-stat">
                <div class="stat-value">--</div>
                <div class="stat-label">Preflight Pass Rate</div>
            </div>
            <div class="stat-card" id="checkpoint-stat">
                <div class="stat-value">--</div>
                <div class="stat-label">Checkpoint Success</div>
            </div>
            <div class="stat-card" id="tasks-stat">
                <div class="stat-value">--</div>
                <div class="stat-label">Tasks Completed</div>
            </div>
            <div class="stat-card" id="retries-stat">
                <div class="stat-value">--</div>
                <div class="stat-label">Total Retries</div>
            </div>
        </div>
    </div>
    
    <!-- 7-Day Trends Chart -->
    <div class="metrics-trends">
        <h3>7-Day Trends</h3>
        <canvas id="trends-chart" width="800" height="300"></canvas>
    </div>
</section>

<style>
.metrics-today { margin-bottom: 20px; }
.stat-cards { display: flex; gap: 15px; flex-wrap: wrap; }
.stat-card {
    background: #1a1a2e;
    border-radius: 8px;
    padding: 20px;
    min-width: 150px;
    text-align: center;
}
.stat-value { font-size: 2em; font-weight: bold; color: #4ade80; }
.stat-value.warning { color: #fbbf24; }
.stat-value.error { color: #ef4444; }
.stat-label { color: #888; font-size: 0.9em; margin-top: 5px; }
.alerts-banner {
    background: #7f1d1d;
    border: 1px solid #ef4444;
    border-radius: 8px;
    padding: 15px;
    margin-bottom: 20px;
}
.alerts-banner .alert-item { margin: 5px 0; }
</style>

<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<script>
let trendsChart = null;

async function loadMetrics() {
    try {
        const response = await fetch('/api/metrics');
        const data = await response.json();
        
        // Update today's stats
        updateTodayStats(data.today);
        
        // Update alerts
        updateAlerts(data.alerts);
        
        // Update trends chart
        updateTrendsChart(data.trends);
        
    } catch (error) {
        console.error('Failed to load metrics:', error);
    }
}

function updateTodayStats(today) {
    // Preflight
    if (today.preflight_pass) {
        const rate = today.preflight_pass.success_rate;
        const el = document.querySelector('#preflight-stat .stat-value');
        el.textContent = `${rate}%`;
        el.className = 'stat-value ' + (rate >= 80 ? '' : rate >= 50 ? 'warning' : 'error');
    }
    
    // Checkpoint
    if (today.checkpoint_success) {
        const rate = today.checkpoint_success.success_rate;
        const el = document.querySelector('#checkpoint-stat .stat-value');
        el.textContent = `${rate}%`;
        el.className = 'stat-value ' + (rate >= 95 ? '' : rate >= 80 ? 'warning' : 'error');
    }
    
    // Tasks completed
    if (today.task_complete) {
        document.querySelector('#tasks-stat .stat-value').textContent = 
            today.task_complete.total_count;
    }
    
    // Retries
    if (today.task_retry) {
        const count = today.task_retry.total_count;
        const el = document.querySelector('#retries-stat .stat-value');
        el.textContent = count;
        el.className = 'stat-value ' + (count <= 3 ? '' : count <= 5 ? 'warning' : 'error');
    }
}

function updateAlerts(alerts) {
    const banner = document.getElementById('alerts-banner');
    if (alerts && alerts.length > 0) {
        banner.innerHTML = alerts.map(a => `<div class="alert-item">${a}</div>`).join('');
        banner.style.display = 'block';
    } else {
        banner.style.display = 'none';
    }
}

function updateTrendsChart(trends) {
    const ctx = document.getElementById('trends-chart').getContext('2d');
    
    // Destroy existing chart
    if (trendsChart) {
        trendsChart.destroy();
    }
    
    // Build datasets
    const datasets = [];
    const colors = {
        'preflight_pass': '#4ade80',
        'checkpoint_success': '#60a5fa',
        'task_complete': '#fbbf24',
        'truncation_recovery': '#ef4444'
    };
    
    let labels = [];
    
    for (const [metric, data] of Object.entries(trends)) {
        if (data.dates.length > labels.length) {
            labels = data.dates;
        }
        
        datasets.push({
            label: metric.replace(/_/g, ' '),
            data: data.rates,
            borderColor: colors[metric] || '#888',
            backgroundColor: 'transparent',
            tension: 0.3
        });
    }
    
    trendsChart = new Chart(ctx, {
        type: 'line',
        data: { labels, datasets },
        options: {
            responsive: true,
            plugins: {
                legend: { position: 'bottom' }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    max: 100,
                    title: { display: true, text: 'Success Rate %' }
                }
            }
        }
    });
}

// Load metrics on page load and every 30 seconds
loadMetrics();
setInterval(loadMetrics, 30000);
</script>
```

---

### 6. ALERT THRESHOLDS (Summary)

| Metric | Threshold | Alert Level |
|--------|-----------|-------------|
| Preflight pass rate | < 80% | ⚠️ Warning |
| Preflight pass rate | < 50% | 🚨 Critical |
| Checkpoint success | < 95% | ⚠️ Warning |
| Checkpoint success | < 80% | 🚨 Critical |
| Daily retry count | > 3 | ⚠️ Warning |
| Daily retry count | > 5 | 🚨 Critical |
| Truncation recovery | Any | ⚠️ Warning (notable event) |

---

### 7. SCHEMA MIGRATION (One-time)

Run to add metrics table to existing learnings.db:

```powershell
# scripts/migrate-add-metrics.ps1
$workspace = "C:\dev\FsuelsBot\workspace"
$dbPath = "$workspace\memory\learnings.db"

$sql = @"
CREATE TABLE IF NOT EXISTS metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    metric_name TEXT NOT NULL,
    metric_value REAL DEFAULT 1.0,
    session_id TEXT,
    task_id TEXT,
    details TEXT,
    recorded_at TEXT DEFAULT (datetime('now')),
    recorded_date TEXT DEFAULT (date('now'))
);

CREATE INDEX IF NOT EXISTS idx_metrics_name ON metrics(metric_name);
CREATE INDEX IF NOT EXISTS idx_metrics_date ON metrics(recorded_date);
CREATE INDEX IF NOT EXISTS idx_metrics_name_date ON metrics(metric_name, recorded_date);

CREATE VIEW IF NOT EXISTS metrics_today AS
SELECT 
    metric_name,
    COUNT(*) as total_count,
    SUM(metric_value) as success_count,
    ROUND(SUM(metric_value) * 100.0 / COUNT(*), 1) as success_rate
FROM metrics
WHERE recorded_date = date('now')
GROUP BY metric_name;

CREATE VIEW IF NOT EXISTS metrics_7day AS
SELECT 
    metric_name,
    recorded_date,
    COUNT(*) as total_count,
    SUM(metric_value) as success_count,
    ROUND(SUM(metric_value) * 100.0 / COUNT(*), 1) as success_rate
FROM metrics
WHERE recorded_date >= date('now', '-7 days')
GROUP BY metric_name, recorded_date
ORDER BY metric_name, recorded_date;
"@

sqlite3 $dbPath $sql
Write-Host "[OK] Metrics table and views added to learnings.db" -ForegroundColor Green
```

---

## IMPLEMENTATION CHECKLIST

- [ ] Run migration script to add metrics table
- [ ] Add `scripts/metrics.py` (Python metrics module)
- [ ] Update `preflight-check.ps1` to call metrics.record_preflight()
- [ ] Create `mid-session-checkpoint.ps1` hook (if not exists)
- [ ] Add `/api/metrics` endpoint to `activity-server.py`
- [ ] Add metrics dashboard section to Mission Control HTML
- [ ] Test Chart.js integration

---

## VERDICT

This design extends the existing infrastructure without rebuilding:
- **Reuses learnings.db** — just adds a new table, same location
- **Extends Mission Control** — new API endpoint + dashboard section
- **Simple schema** — flexible metric_name + value pattern, no over-engineering
- **Chart.js** — lightweight, CDN-hosted, no new dependencies
- **Threshold-based alerts** — actionable, not vanity metrics

**Grade: A-** — Implementation-ready, clean MVP. Could add histogram analysis and anomaly detection later for A+.

---

*Session generated: 2026-01-29 by Council subagent*
*Note: Browser automation challenges prevented full cross-AI debate. Synthesis based on deep infrastructure analysis and observability best practices.*
