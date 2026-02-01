#!/usr/bin/env python3
"""
Backlog Generator - Self-Generating Task Queue
Scans multiple sources for opportunities and auto-creates tasks in tasks.json.

Usage:
    python backlog-generator.py --scan-all          # Full scan of all sources
    python backlog-generator.py --source seo        # Scan specific source
    python backlog-generator.py --dry-run           # Preview without creating
    python backlog-generator.py --force             # Ignore dedup, force create

Sources: website_audit, competitor, content_gap, error_pattern, seasonal, analytics
"""

import json
import os
import sys
import argparse
from datetime import datetime, timezone, timedelta
from pathlib import Path
import hashlib
import re

# Paths
WORKSPACE = Path(__file__).parent.parent
TASKS_FILE = WORKSPACE / "memory" / "tasks.json"
DEDUP_FILE = WORKSPACE / "memory" / "backlog-dedup.json"
REPORTS_DIR = WORKSPACE / "memory" / "backlog-reports"
EVENTS_FILE = WORKSPACE / "memory" / "events.jsonl"
SEASONAL_FILE = WORKSPACE / "config" / "seasonal-calendar.yaml"
SEO_AUDIT_FILE = WORKSPACE / "memory" / "seo-audit.json"
ERROR_DIR = WORKSPACE / "memory"
LEARNINGS_DIR = WORKSPACE / ".learnings"

# Thresholds
SCORE_THRESHOLD_HIGH = 12  # Immediate queue
SCORE_THRESHOLD_LOW = 8    # Low priority queue
MAX_TASKS_PER_RUN = 10
DEDUP_WINDOW_DAYS = 7
CONFIDENCE_FLOOR = 0.4

# Agent types
AGENT_TYPES = ["seo", "content", "marketing", "analytics", "conversion", "engineering", "operations", "research"]


def load_json(path: Path, default=None):
    """Load JSON file with fallback."""
    if not path.exists():
        return default if default is not None else {}
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print(f"WARN: Failed to load {path}: {e}")
        return default if default is not None else {}


def save_json(path: Path, data: dict):
    """Save JSON file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def append_jsonl(path: Path, record: dict):
    """Append to JSONL file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, 'a', encoding='utf-8') as f:
        f.write(json.dumps(record, ensure_ascii=False) + '\n')


def compute_dedup_key(source: str, key: str) -> str:
    """Generate deduplication key."""
    raw = f"{source}:{key}"
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def is_duplicate(dedup_data: dict, source: str, key: str) -> bool:
    """Check if opportunity was already processed recently."""
    dedup_key = compute_dedup_key(source, key)
    if dedup_key not in dedup_data:
        return False
    
    entry = dedup_data[dedup_key]
    created_at = datetime.fromisoformat(entry.get('created_at', '2000-01-01'))
    if datetime.now(timezone.utc) - created_at < timedelta(days=DEDUP_WINDOW_DAYS):
        return True
    return False


def check_title_similarity(existing_tasks: dict, new_title: str, threshold=0.8) -> bool:
    """Check if similar task already exists using simple word overlap."""
    new_words = set(new_title.lower().split())
    
    for task_id, task in existing_tasks.items():
        if isinstance(task, dict) and task.get('status') != 'done':
            existing_title = task.get('title', '')
            existing_words = set(existing_title.lower().split())
            
            if not existing_words:
                continue
            
            # Jaccard similarity
            intersection = len(new_words & existing_words)
            union = len(new_words | existing_words)
            similarity = intersection / union if union > 0 else 0
            
            if similarity >= threshold:
                return True
    
    return False


def get_next_task_id(tasks_data: dict) -> str:
    """Get next available task ID."""
    max_id = 0
    for task_id in tasks_data.get('tasks', {}).keys():
        if task_id.startswith('T') and task_id[1:].isdigit():
            max_id = max(max_id, int(task_id[1:]))
    return f"T{max_id + 1}"


def score_opportunity(impact: int, urgency: int, effort: int, confidence: int) -> int:
    """Calculate opportunity score (0-20)."""
    return min(impact, 8) + min(urgency, 5) + min(effort, 4) + min(confidence, 3)


def create_task(tasks_data: dict, opportunity: dict, dry_run: bool = False) -> str:
    """Create a task from an opportunity."""
    task_id = get_next_task_id(tasks_data)
    now = datetime.now(timezone.utc).isoformat()
    
    task = {
        "title": opportunity['title'],
        "status": "pending",
        "created_at": now,
        "created_by": "backlog-generator",
        "auto_generated": True,
        "source": opportunity['source'],
        "source_key": opportunity.get('source_key', ''),
        "score": opportunity['score'],
        "score_breakdown": opportunity.get('score_breakdown', {}),
        "agent_type": opportunity.get('agent_type', 'operations'),
        "plan": opportunity.get('plan'),
        "approach": opportunity.get('approach', ''),
        "context": {
            "summary": opportunity.get('summary', ''),
            "evidence": opportunity.get('evidence', ''),
            "created_from": f"backlog-generator:{opportunity['source']}",
            "decisions": [],
            "constraints": ["Auto-generated - verify evidence before executing"]
        },
        "epistemic": {
            "claims": [],
            "verified": [],
            "assumptions": [
                "Evidence from automated scan - may need human verification",
                opportunity.get('assumption', 'Source data is accurate')
            ],
            "confidence": opportunity.get('confidence', 0.6),
            "verification_status": "claimed"
        }
    }
    
    if not dry_run:
        tasks_data['tasks'][task_id] = task
        
        # Add to bot_queue
        queue = tasks_data['lanes'].get('bot_queue', [])
        if opportunity['score'] >= SCORE_THRESHOLD_HIGH:
            queue.insert(0, task_id)  # High priority at front
        else:
            queue.append(task_id)  # Low priority at end
        tasks_data['lanes']['bot_queue'] = queue
        
        # Update metadata
        tasks_data['updated_at'] = now
        tasks_data['updated_by'] = 'backlog-generator'
        tasks_data['version'] = tasks_data.get('version', 0) + 1
    
    return task_id


# ============ SOURCE SCANNERS ============

def scan_website_audit(tasks_data: dict, dedup_data: dict, force: bool = False) -> list:
    """Scan website audit findings for SEO opportunities."""
    opportunities = []
    
    # Check SEO audit file
    audit = load_json(SEO_AUDIT_FILE, {})
    
    # Example checks - extend as audit data becomes available
    issues = audit.get('issues', [])
    for issue in issues:
        key = f"audit:{issue.get('type', 'unknown')}:{issue.get('url', 'no-url')}"
        
        if not force and is_duplicate(dedup_data, 'website_audit', key):
            continue
        
        score = score_opportunity(
            impact=issue.get('impact', 4),
            urgency=issue.get('urgency', 2),
            effort=4 - issue.get('effort', 2),  # Invert: lower effort = higher score
            confidence=issue.get('confidence', 2)
        )
        
        if score >= SCORE_THRESHOLD_LOW:
            opportunities.append({
                'title': f"SEO Fix: {issue.get('title', 'Unknown issue')}",
                'source': 'website_audit',
                'source_key': key,
                'score': score,
                'score_breakdown': {
                    'impact': issue.get('impact', 4),
                    'urgency': issue.get('urgency', 2),
                    'effort': 4 - issue.get('effort', 2),
                    'confidence': issue.get('confidence', 2)
                },
                'agent_type': 'seo',
                'plan': 'procedures/seo/README.md',
                'summary': issue.get('description', 'Website audit finding'),
                'evidence': f"Detected: {issue.get('details', 'See audit file')}",
                'confidence': 0.7
            })
    
    return opportunities


def scan_error_patterns(tasks_data: dict, dedup_data: dict, force: bool = False) -> list:
    """Scan error logs for recurring patterns."""
    opportunities = []
    error_counts = {}
    
    # Scan error log archives
    for log_file in ERROR_DIR.glob("error-log-archive-*.jsonl"):
        try:
            with open(log_file, 'r', encoding='utf-8') as f:
                for line in f:
                    if not line.strip():
                        continue
                    try:
                        error = json.loads(line)
                        error_type = error.get('type', error.get('error', 'unknown'))
                        error_key = f"{error_type}:{error.get('context', 'no-context')}"
                        
                        if error_key not in error_counts:
                            error_counts[error_key] = {
                                'count': 0,
                                'type': error_type,
                                'examples': [],
                                'last_seen': None
                            }
                        
                        error_counts[error_key]['count'] += 1
                        error_counts[error_key]['last_seen'] = error.get('timestamp')
                        if len(error_counts[error_key]['examples']) < 3:
                            error_counts[error_key]['examples'].append(error.get('message', '')[:200])
                    except json.JSONDecodeError:
                        continue
        except Exception as e:
            print(f"WARN: Failed to read {log_file}: {e}")
    
    # Also scan ERRORS.md in learnings
    errors_md = LEARNINGS_DIR / "ERRORS.md"
    if errors_md.exists():
        try:
            content = errors_md.read_text(encoding='utf-8')
            # Simple pattern extraction
            for match in re.finditer(r'##\s+(.+?)\n', content):
                error_type = match.group(1)
                key = f"learnings:{error_type}"
                if key not in error_counts:
                    error_counts[key] = {
                        'count': 1,
                        'type': error_type,
                        'examples': [],
                        'last_seen': datetime.now().isoformat()
                    }
        except Exception as e:
            print(f"WARN: Failed to read ERRORS.md: {e}")
    
    # Generate tasks for recurring errors (3+ occurrences)
    for error_key, data in error_counts.items():
        if data['count'] < 3:
            continue
        
        if not force and is_duplicate(dedup_data, 'error_pattern', error_key):
            continue
        
        # Higher count = higher urgency
        urgency = min(data['count'] // 3, 5)
        
        score = score_opportunity(
            impact=5,
            urgency=urgency,
            effort=3,
            confidence=2
        )
        
        if score >= SCORE_THRESHOLD_LOW:
            opportunities.append({
                'title': f"Fix Recurring Error: {data['type'][:50]}",
                'source': 'error_pattern',
                'source_key': error_key,
                'score': score,
                'score_breakdown': {
                    'impact': 5,
                    'urgency': urgency,
                    'effort': 3,
                    'confidence': 2
                },
                'agent_type': 'engineering',
                'summary': f"Error occurred {data['count']} times. Type: {data['type']}",
                'evidence': f"Examples: {'; '.join(data['examples'][:2])}",
                'confidence': 0.65
            })
    
    return opportunities


def scan_seasonal_events(tasks_data: dict, dedup_data: dict, force: bool = False) -> list:
    """Scan for upcoming seasonal events."""
    opportunities = []
    
    # Hardcoded seasonal calendar (can be moved to YAML later)
    seasonal_events = [
        {'name': 'Valentine\'s Day', 'date': (2, 14), 'prep_days': 14, 'agent': 'marketing'},
        {'name': 'Easter', 'date': (4, 20), 'prep_days': 21, 'agent': 'marketing'},  # 2026 Easter
        {'name': 'Mother\'s Day', 'date': (5, 10), 'prep_days': 21, 'agent': 'marketing'},  # 2nd Sunday May
        {'name': 'Father\'s Day', 'date': (6, 21), 'prep_days': 21, 'agent': 'marketing'},  # 3rd Sunday June
        {'name': 'Back to School', 'date': (8, 1), 'prep_days': 30, 'agent': 'marketing'},
        {'name': 'Halloween', 'date': (10, 31), 'prep_days': 30, 'agent': 'marketing'},
        {'name': 'Thanksgiving', 'date': (11, 27), 'prep_days': 21, 'agent': 'marketing'},  # 4th Thursday
        {'name': 'Black Friday', 'date': (11, 28), 'prep_days': 30, 'agent': 'marketing'},
        {'name': 'Cyber Monday', 'date': (12, 1), 'prep_days': 30, 'agent': 'marketing'},
        {'name': 'Christmas', 'date': (12, 25), 'prep_days': 45, 'agent': 'marketing'},
    ]
    
    today = datetime.now()
    
    for event in seasonal_events:
        # Calculate event date for current/next year
        event_month, event_day = event['date']
        event_date = datetime(today.year, event_month, event_day)
        
        # If event has passed this year, check next year
        if event_date < today:
            event_date = datetime(today.year + 1, event_month, event_day)
        
        days_until = (event_date - today).days
        prep_deadline = days_until - event['prep_days']
        
        # Only create tasks if within prep window and not too far out
        if prep_deadline <= 7 and days_until > 0 and days_until <= 60:
            key = f"seasonal:{event['name']}:{event_date.year}"
            
            if not force and is_duplicate(dedup_data, 'seasonal', key):
                continue
            
            # Closer = more urgent
            urgency = 5 if prep_deadline <= 0 else (4 if prep_deadline <= 3 else 3)
            
            score = score_opportunity(
                impact=7,
                urgency=urgency,
                effort=3,
                confidence=3
            )
            
            if score >= SCORE_THRESHOLD_LOW:
                opportunities.append({
                    'title': f"{event['name']} Campaign Prep ({days_until} days out)",
                    'source': 'seasonal',
                    'source_key': key,
                    'score': score,
                    'score_breakdown': {
                        'impact': 7,
                        'urgency': urgency,
                        'effort': 3,
                        'confidence': 3
                    },
                    'agent_type': event['agent'],
                    'plan': f"procedures/{event['name'].lower().replace(' ', '-')}-campaign.md" if os.path.exists(f"procedures/{event['name'].lower().replace(' ', '-')}-campaign.md") else 'procedures/marketing/campaigns.md',
                    'summary': f"Prep for {event['name']} ({event_date.strftime('%B %d')}). {days_until} days remaining, {event['prep_days']} days recommended prep time.",
                    'evidence': f"Seasonal calendar: {event['name']} on {event_date.strftime('%Y-%m-%d')}",
                    'confidence': 0.9,
                    'approach': f"1. Review {event['name'].lower()} product inventory\\n2. Create/update landing page\\n3. Prepare marketing assets\\n4. Set up promotions\\n5. Update homepage banners"
                })
    
    return opportunities


def scan_content_gaps(tasks_data: dict, dedup_data: dict, force: bool = False) -> list:
    """Scan for content gaps that need filling."""
    opportunities = []
    
    # Check for collections needing descriptions (from SEO knowledge)
    content_gaps_file = WORKSPACE / "memory" / "content-gaps.json"
    gaps = load_json(content_gaps_file, {'collections': [], 'products': []})
    
    for gap in gaps.get('collections', []):
        key = f"content:collection:{gap.get('handle', 'unknown')}"
        
        if not force and is_duplicate(dedup_data, 'content_gap', key):
            continue
        
        score = score_opportunity(
            impact=5,
            urgency=2,
            effort=3,
            confidence=2
        )
        
        if score >= SCORE_THRESHOLD_LOW:
            opportunities.append({
                'title': f"Add SEO copy to collection: {gap.get('title', 'Unknown')}",
                'source': 'content_gap',
                'source_key': key,
                'score': score,
                'score_breakdown': {'impact': 5, 'urgency': 2, 'effort': 3, 'confidence': 2},
                'agent_type': 'content',
                'plan': 'procedures/seo/README.md',
                'summary': f"Collection '{gap.get('title')}' needs 150+ words of unique SEO copy.",
                'evidence': f"Current word count: {gap.get('word_count', 0)}",
                'confidence': 0.7
            })
    
    return opportunities


def scan_analytics_signals(tasks_data: dict, dedup_data: dict, force: bool = False) -> list:
    """Scan analytics for concerning signals."""
    opportunities = []
    
    analytics_file = WORKSPACE / "memory" / "analytics-signals.json"
    signals = load_json(analytics_file, {'alerts': []})
    
    for alert in signals.get('alerts', []):
        key = f"analytics:{alert.get('type', 'unknown')}:{alert.get('metric', 'unknown')}"
        
        if not force and is_duplicate(dedup_data, 'analytics', key):
            continue
        
        change_pct = abs(alert.get('change_pct', 0))
        urgency = 5 if change_pct > 30 else (3 if change_pct > 20 else 2)
        
        score = score_opportunity(
            impact=6,
            urgency=urgency,
            effort=2,
            confidence=2
        )
        
        if score >= SCORE_THRESHOLD_LOW:
            opportunities.append({
                'title': f"Investigate: {alert.get('metric', 'Metric')} {'+' if alert.get('change_pct', 0) > 0 else ''}{alert.get('change_pct', 0)}%",
                'source': 'analytics',
                'source_key': key,
                'score': score,
                'score_breakdown': {'impact': 6, 'urgency': urgency, 'effort': 2, 'confidence': 2},
                'agent_type': 'analytics',
                'summary': f"Analytics alert: {alert.get('description', 'Significant metric change detected')}",
                'evidence': f"Change: {alert.get('change_pct')}% ({alert.get('period', 'period unknown')})",
                'confidence': 0.6
            })
    
    return opportunities


def scan_competitor_changes(tasks_data: dict, dedup_data: dict, force: bool = False) -> list:
    """Scan for competitor changes."""
    opportunities = []
    
    competitor_file = WORKSPACE / "memory" / "competitor-monitor.json"
    monitor = load_json(competitor_file, {'changes': []})
    
    for change in monitor.get('changes', []):
        key = f"competitor:{change.get('competitor', 'unknown')}:{change.get('type', 'unknown')}:{change.get('id', 'no-id')}"
        
        if not force and is_duplicate(dedup_data, 'competitor', key):
            continue
        
        score = score_opportunity(
            impact=change.get('impact', 4),
            urgency=change.get('urgency', 2),
            effort=3,
            confidence=2
        )
        
        if score >= SCORE_THRESHOLD_LOW:
            opportunities.append({
                'title': f"Competitor Alert: {change.get('competitor', 'Unknown')} - {change.get('type', 'change')}",
                'source': 'competitor',
                'source_key': key,
                'score': score,
                'score_breakdown': {
                    'impact': change.get('impact', 4),
                    'urgency': change.get('urgency', 2),
                    'effort': 3,
                    'confidence': 2
                },
                'agent_type': 'research',
                'summary': change.get('summary', 'Competitor change detected'),
                'evidence': change.get('evidence', 'See monitor file'),
                'confidence': 0.5
            })
    
    return opportunities


# ============ MAIN EXECUTION ============

SOURCE_SCANNERS = {
    'website_audit': scan_website_audit,
    'error_pattern': scan_error_patterns,
    'seasonal': scan_seasonal_events,
    'content_gap': scan_content_gaps,
    'analytics': scan_analytics_signals,
    'competitor': scan_competitor_changes,
}


def run_backlog_generator(sources: list = None, dry_run: bool = False, force: bool = False):
    """Main entry point for backlog generation."""
    print(f"=== Backlog Generator ===")
    print(f"Time: {datetime.now().isoformat()}")
    print(f"Mode: {'DRY RUN' if dry_run else 'LIVE'}")
    print(f"Force: {force}")
    print()
    
    # Load existing data
    tasks_data = load_json(TASKS_FILE, {'tasks': {}, 'lanes': {'bot_queue': []}})
    dedup_data = load_json(DEDUP_FILE, {})
    
    # Determine which sources to scan
    if sources is None or 'all' in sources:
        sources = list(SOURCE_SCANNERS.keys())
    
    print(f"Scanning sources: {', '.join(sources)}")
    print()
    
    # Collect all opportunities
    all_opportunities = []
    
    for source in sources:
        if source not in SOURCE_SCANNERS:
            print(f"WARN: Unknown source '{source}', skipping")
            continue
        
        print(f"Scanning: {source}...")
        scanner = SOURCE_SCANNERS[source]
        opportunities = scanner(tasks_data, dedup_data, force)
        print(f"  Found: {len(opportunities)} opportunities")
        all_opportunities.extend(opportunities)
    
    print()
    print(f"Total opportunities: {len(all_opportunities)}")
    
    # Sort by score (highest first)
    all_opportunities.sort(key=lambda x: x['score'], reverse=True)
    
    # Filter and create tasks
    tasks_created = []
    duplicates_skipped = 0
    below_threshold = 0
    
    for opp in all_opportunities:
        if len(tasks_created) >= MAX_TASKS_PER_RUN:
            print(f"LIMIT: Max {MAX_TASKS_PER_RUN} tasks per run reached")
            break
        
        # Check score threshold
        if opp['score'] < SCORE_THRESHOLD_LOW:
            below_threshold += 1
            continue
        
        # Check confidence floor
        if opp.get('confidence', 1.0) < CONFIDENCE_FLOOR:
            print(f"SKIP: {opp['title'][:50]} (confidence {opp.get('confidence')} < {CONFIDENCE_FLOOR})")
            continue
        
        # Check title similarity
        if check_title_similarity(tasks_data.get('tasks', {}), opp['title']):
            duplicates_skipped += 1
            print(f"SKIP: Similar task exists: {opp['title'][:50]}")
            continue
        
        # Create the task
        task_id = create_task(tasks_data, opp, dry_run)
        tasks_created.append({
            'id': task_id,
            'title': opp['title'],
            'score': opp['score'],
            'source': opp['source'],
            'agent_type': opp.get('agent_type', 'operations')
        })
        
        # Record in dedup
        if not dry_run:
            dedup_key = compute_dedup_key(opp['source'], opp['source_key'])
            dedup_data[dedup_key] = {
                'created_at': datetime.now(timezone.utc).isoformat(),
                'task_id': task_id,
                'source': opp['source'],
                'key': opp['source_key']
            }
        
        status = "WOULD CREATE" if dry_run else "CREATED"
        print(f"{status}: [{task_id}] {opp['title'][:60]} (score: {opp['score']}, agent: {opp.get('agent_type')})")
    
    print()
    print(f"=== Summary ===")
    print(f"Tasks created: {len(tasks_created)}")
    print(f"Duplicates skipped: {duplicates_skipped}")
    print(f"Below threshold: {below_threshold}")
    
    # Save updated data
    if not dry_run and tasks_created:
        save_json(TASKS_FILE, tasks_data)
        save_json(DEDUP_FILE, dedup_data)
        print(f"Saved: tasks.json, backlog-dedup.json")
        
        # Log event
        event = {
            'type': 'backlog_generated',
            'timestamp': datetime.now(timezone.utc).isoformat(),
            'sources_scanned': sources,
            'opportunities_found': len(all_opportunities),
            'tasks_created': len(tasks_created),
            'task_ids': [t['id'] for t in tasks_created]
        }
        append_jsonl(EVENTS_FILE, event)
        print(f"Logged to events.jsonl")
        
        # Save report
        report = {
            'run_date': datetime.now().strftime('%Y-%m-%d'),
            'run_time': datetime.now().isoformat(),
            'sources_scanned': sources,
            'opportunities_found': len(all_opportunities),
            'tasks_created': len(tasks_created),
            'duplicates_skipped': duplicates_skipped,
            'below_threshold': below_threshold,
            'tasks': tasks_created
        }
        REPORTS_DIR.mkdir(parents=True, exist_ok=True)
        report_file = REPORTS_DIR / f"{datetime.now().strftime('%Y-%m-%d')}.json"
        save_json(report_file, report)
        print(f"Report saved: {report_file}")
    
    return {
        'tasks_created': tasks_created,
        'duplicates_skipped': duplicates_skipped,
        'below_threshold': below_threshold,
        'total_opportunities': len(all_opportunities)
    }


def main():
    parser = argparse.ArgumentParser(description="Self-Generating Backlog System")
    parser.add_argument("--scan-all", action="store_true", help="Scan all sources")
    parser.add_argument("--source", action="append", dest="sources", help="Specific source to scan (can repeat)")
    parser.add_argument("--dry-run", action="store_true", help="Preview without creating tasks")
    parser.add_argument("--force", action="store_true", help="Ignore deduplication")
    
    args = parser.parse_args()
    
    sources = None
    if args.scan_all:
        sources = ['all']
    elif args.sources:
        sources = args.sources
    else:
        sources = ['all']  # Default to all
    
    result = run_backlog_generator(
        sources=sources,
        dry_run=args.dry_run,
        force=args.force
    )
    
    sys.exit(0 if result['tasks_created'] or result['total_opportunities'] == 0 else 1)


if __name__ == "__main__":
    main()
