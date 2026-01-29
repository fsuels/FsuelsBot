#!/usr/bin/env python3
"""
Staleness checker for knowledge wiki.
Council-designed: Grade A — YAML frontmatter versioning
Run nightly at 3 AM EST by consolidation job.
"""

import os
import sys
from datetime import date
from pathlib import Path

# Configuration
WORKSPACE = Path(r"C:\dev\FsuelsBot\workspace")
KNOWLEDGE_DIR = WORKSPACE / "knowledge"
OUTPUT_FILE = KNOWLEDGE_DIR / "review-queue.md"

DEFAULT_THRESHOLDS = {
    "entities": 90,
    "procedures": 30,
    "principles": 180,
    "insights": 60,
}

def parse_frontmatter(path):
    """Extract YAML frontmatter from markdown file."""
    try:
        with open(path, 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception as e:
        return None
    
    if not content.startswith('---'):
        return None
    
    end = content.find('---', 3)
    if end == -1:
        return None
    
    try:
        # Simple YAML parsing without external dependency
        frontmatter = {}
        for line in content[3:end].strip().split('\n'):
            if ':' in line:
                key, value = line.split(':', 1)
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                frontmatter[key] = value
        return frontmatter
    except:
        return None

def get_category(path):
    """Get category from file path."""
    try:
        parts = path.relative_to(KNOWLEDGE_DIR).parts
        return parts[0] if parts else "unknown"
    except:
        return "unknown"

def calculate_staleness(meta, category):
    """Return (is_stale, days_since_verified, severity)."""
    threshold = DEFAULT_THRESHOLDS.get(category, 30)
    
    # Check for custom review_cycle
    if 'review_cycle' in meta:
        try:
            threshold = int(meta['review_cycle'])
        except:
            pass
    
    verified = meta.get('verified')
    if not verified:
        return True, 999, "critical"
    
    try:
        if isinstance(verified, str):
            verified = date.fromisoformat(verified)
        days = (date.today() - verified).days
    except:
        return True, 999, "critical"
    
    if days <= threshold:
        return False, days, None
    
    over = days - threshold
    if over > 30:
        return True, days, "critical"
    elif over > 7:
        return True, days, "stale"
    else:
        return True, days, "warning"

def scan_knowledge():
    """Scan all knowledge files and return staleness report."""
    results = {"critical": [], "stale": [], "warning": [], "fresh": []}
    
    if not KNOWLEDGE_DIR.exists():
        return results
    
    for path in KNOWLEDGE_DIR.rglob("*.md"):
        # Skip special files
        if path.name in ['review-queue.md', 'README.md']:
            continue
        if '.archive' in str(path):
            continue
        
        meta = parse_frontmatter(path)
        if not meta:
            results["critical"].append({
                "path": str(path.relative_to(KNOWLEDGE_DIR)),
                "days": 999,
                "verified": "NO FRONTMATTER",
                "category": get_category(path)
            })
            continue
        
        category = get_category(path)
        is_stale, days, severity = calculate_staleness(meta, category)
        
        item = {
            "path": str(path.relative_to(KNOWLEDGE_DIR)),
            "days": days,
            "verified": meta.get('verified', 'unknown'),
            "category": category
        }
        
        if severity:
            results[severity].append(item)
        else:
            results["fresh"].append(item)
    
    return results

def generate_report(results):
    """Generate markdown report."""
    lines = [
        "# Knowledge Review Queue",
        f"Generated: {date.today().isoformat()}",
        f"Total items: {sum(len(v) for v in results.values())}",
        ""
    ]
    
    for severity, emoji, label in [
        ("critical", "🔴", "CRITICAL (must review immediately)"),
        ("stale", "🟠", "STALE (priority review)"),
        ("warning", "⚠️", "WARNING (review this week)"),
    ]:
        items = results[severity]
        lines.append(f"## {emoji} {label}")
        if items:
            lines.append("| File | Days Stale | Last Verified | Category |")
            lines.append("|------|------------|---------------|----------|")
            for item in sorted(items, key=lambda x: -x['days']):
                lines.append(f"| {item['path']} | {item['days']} | {item['verified']} | {item['category']} |")
        else:
            lines.append("*None*")
        lines.append("")
    
    # Recently verified
    fresh = sorted(results['fresh'], key=lambda x: str(x['verified']), reverse=True)[:5]
    lines.append("## ✅ Recently Verified")
    if fresh:
        for item in fresh:
            lines.append(f"- {item['path']} ({item['verified']})")
    else:
        lines.append("*No recently verified files*")
    
    return "\n".join(lines)

def main():
    results = scan_knowledge()
    report = generate_report(results)
    
    # Ensure directory exists
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        f.write(report)
    
    # Summary for logging
    print(f"Staleness check complete:")
    print(f"  Critical: {len(results['critical'])}")
    print(f"  Stale: {len(results['stale'])}")
    print(f"  Warning: {len(results['warning'])}")
    print(f"  Fresh: {len(results['fresh'])}")
    
    return 0 if len(results['critical']) == 0 else 1

if __name__ == "__main__":
    sys.exit(main())
