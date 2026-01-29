#!/usr/bin/env python3
"""
metrics.py — Record metrics for observability dashboard
Council-designed: Grade A- (Aggregated Observability)
"""

import sqlite3
import json
import sys
from datetime import datetime
from pathlib import Path

WORKSPACE = Path(r"C:\dev\FsuelsBot\workspace")
DB_PATH = WORKSPACE / "memory" / "learnings.db"

def ensure_metrics_table():
    """Create metrics table if not exists. Uses WAL mode for crash safety."""
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    
    # Council A+ fix: Enable WAL mode for crash safety
    cur.execute("PRAGMA journal_mode=WAL;")
    
    cur.executescript("""
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
    """)
    
    conn.commit()
    conn.close()

def record_metric(metric_name: str, value: float = 1.0, 
                  session_id: str = None, task_id: str = None, 
                  details: dict = None):
    """Record a single metric event."""
    ensure_metrics_table()
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
        details={'digest': digest, 'errors': errors or []}
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
    record_metric('task_complete', 1.0, task_id=task_id, details={'retry_count': retry_count})
    if retry_count > 0:
        record_metric('task_retry', float(retry_count), task_id=task_id)

def record_circuit_event(api: str, event_type: str, error_type: str = None):
    """Record circuit breaker event. Integrates circuit-breaker.ps1 with metrics."""
    record_metric(
        metric_name=f'circuit_{event_type}',
        value=1.0,
        details={'api': api, 'error_type': error_type}
    )

def record_api_call(api: str, success: bool, latency_ms: int = None):
    """Record API call result for circuit breaker tracking."""
    record_metric(
        metric_name='api_call',
        value=1.0 if success else 0.0,
        details={'api': api, 'latency_ms': latency_ms}
    )

def get_today_summary() -> dict:
    """Get today's metrics summary."""
    ensure_metrics_table()
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    
    cur.execute("""
        SELECT 
            metric_name,
            COUNT(*) as total_count,
            SUM(metric_value) as success_count,
            ROUND(SUM(metric_value) * 100.0 / COUNT(*), 1) as success_rate
        FROM metrics
        WHERE recorded_date = date('now')
        GROUP BY metric_name
    """)
    
    rows = cur.fetchall()
    conn.close()
    
    return {row[0]: {'total_count': row[1], 'success_count': row[2], 'success_rate': row[3]} for row in rows}

def get_7day_trends() -> dict:
    """Get 7-day trends by metric."""
    ensure_metrics_table()
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    
    cur.execute("""
        SELECT 
            metric_name,
            recorded_date,
            COUNT(*) as total_count,
            SUM(metric_value) as success_count,
            ROUND(SUM(metric_value) * 100.0 / COUNT(*), 1) as success_rate
        FROM metrics
        WHERE recorded_date >= date('now', '-7 days')
        GROUP BY metric_name, recorded_date
        ORDER BY metric_name, recorded_date
    """)
    
    rows = cur.fetchall()
    conn.close()
    
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
    """Check for alert conditions including circuit breaker status."""
    alerts = []
    summary = get_today_summary()
    
    if 'preflight_pass' in summary:
        rate = summary['preflight_pass'].get('success_rate', 100)
        if rate < 80:
            alerts.append(f"⚠️ Preflight pass rate low: {rate}%")
    
    if 'task_retry' in summary:
        count = summary['task_retry'].get('total_count', 0)
        if count > 3:
            alerts.append(f"⚠️ High retry count: {count}")
    
    if 'checkpoint_success' in summary:
        rate = summary['checkpoint_success'].get('success_rate', 100)
        if rate < 95:
            alerts.append(f"⚠️ Checkpoint success rate low: {rate}%")
    
    # Circuit breaker alerts
    if 'circuit_open' in summary:
        count = summary['circuit_open'].get('total_count', 0)
        if count > 0:
            alerts.append(f"🔴 Circuit breaker opened {count} time(s) today")
    
    if 'api_call' in summary:
        rate = summary['api_call'].get('success_rate', 100)
        if rate < 90:
            alerts.append(f"⚠️ API success rate low: {rate}%")
    
    return alerts

def get_status() -> dict:
    """Get full metrics status for API."""
    return {
        'today': get_today_summary(),
        'trends': get_7day_trends(),
        'alerts': check_alerts(),
        'generatedAt': datetime.now().isoformat()
    }

def get_prometheus_metrics() -> str:
    """
    Council A+ requirement: Export metrics in Prometheus text format.
    Enables external scraping and centralized monitoring.
    """
    lines = []
    summary = get_today_summary()
    
    # Export each metric in Prometheus format
    for metric_name, data in summary.items():
        # Sanitize metric name for Prometheus (alphanumeric + underscore only)
        safe_name = metric_name.replace('-', '_').replace('.', '_')
        
        # Total count
        lines.append(f"# HELP clawdbot_{safe_name}_total Total count of {metric_name}")
        lines.append(f"# TYPE clawdbot_{safe_name}_total counter")
        lines.append(f"clawdbot_{safe_name}_total {data.get('total_count', 0)}")
        
        # Success count (if applicable)
        lines.append(f"# HELP clawdbot_{safe_name}_success Success count of {metric_name}")
        lines.append(f"# TYPE clawdbot_{safe_name}_success counter")
        lines.append(f"clawdbot_{safe_name}_success {data.get('success_count', 0)}")
        
        # Success rate as gauge
        lines.append(f"# HELP clawdbot_{safe_name}_success_rate Success rate percentage")
        lines.append(f"# TYPE clawdbot_{safe_name}_success_rate gauge")
        lines.append(f"clawdbot_{safe_name}_success_rate {data.get('success_rate', 100)}")
    
    # Add system health metrics
    alerts = check_alerts()
    lines.append("# HELP clawdbot_alerts_active Number of active alerts")
    lines.append("# TYPE clawdbot_alerts_active gauge")
    lines.append(f"clawdbot_alerts_active {len(alerts)}")
    
    # Add uptime info
    lines.append("# HELP clawdbot_metrics_generated_timestamp Unix timestamp of last generation")
    lines.append("# TYPE clawdbot_metrics_generated_timestamp gauge")
    lines.append(f"clawdbot_metrics_generated_timestamp {datetime.now().timestamp()}")
    
    return '\n'.join(lines) + '\n'

if __name__ == "__main__":
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
                print(f"  {alert}")
        else:
            print("No alerts")
    
    elif cmd == "record" and len(sys.argv) >= 4:
        record_metric(sys.argv[2], float(sys.argv[3]))
    
    elif cmd == "prometheus":
        # Council A+: Export in Prometheus text format
        print(get_prometheus_metrics())
    
    elif cmd == "status":
        print(json.dumps(get_status(), indent=2))
    
    else:
        print("Unknown command")
        sys.exit(1)
