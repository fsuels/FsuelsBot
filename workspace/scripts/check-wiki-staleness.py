#!/usr/bin/env python3
"""
check-wiki-staleness.py — Detect stale wiki files needing review
Council A- upgrade: Automated staleness detection for Wiki Versioning

Run in heartbeat or daily cron to catch outdated knowledge files.
"""

import os
import re
import sys
from datetime import datetime, timedelta
from pathlib import Path

WORKSPACE = Path(r"C:\dev\FsuelsBot\workspace")
KNOWLEDGE_DIR = WORKSPACE / "knowledge"
PROCEDURES_DIR = WORKSPACE / "procedures"
STALE_DAYS = 30  # Files not updated in 30 days are stale
VERY_STALE_DAYS = 90  # Files not updated in 90 days need urgent review

def parse_frontmatter(content: str) -> dict:
    """Extract frontmatter from markdown file."""
    if not content.startswith('---'):
        return {}
    
    try:
        end = content.index('---', 3)
        frontmatter = content[3:end].strip()
        
        result = {}
        for line in frontmatter.split('\n'):
            if ':' in line:
                key, value = line.split(':', 1)
                # Strip quotes from values (YAML style)
                value = value.strip().strip('"').strip("'")
                result[key.strip()] = value
        return result
    except ValueError:
        return {}

def check_file(filepath: Path) -> dict:
    """Check a single file for staleness."""
    try:
        content = filepath.read_text(encoding='utf-8')
    except Exception as e:
        return {'path': str(filepath), 'error': str(e)}
    
    fm = parse_frontmatter(content)
    
    # Get last updated date
    updated = fm.get('updated') or fm.get('last_updated') or fm.get('verified_on')
    
    if not updated:
        # No frontmatter date - use file modification time
        mtime = datetime.fromtimestamp(filepath.stat().st_mtime)
        updated = mtime.strftime('%Y-%m-%d')
        has_frontmatter = False
    else:
        has_frontmatter = True
    
    # Parse date
    try:
        # Handle various date formats
        for fmt in ['%Y-%m-%d', '%Y-%m-%d %H:%M', '%B %d, %Y']:
            try:
                updated_date = datetime.strptime(updated.split()[0], fmt)
                break
            except ValueError:
                continue
        else:
            updated_date = datetime.now() - timedelta(days=365)  # Assume very old
    except Exception:
        updated_date = datetime.now() - timedelta(days=365)
    
    days_old = (datetime.now() - updated_date).days
    
    status = 'current'
    if days_old > VERY_STALE_DAYS:
        status = 'very_stale'
    elif days_old > STALE_DAYS:
        status = 'stale'
    
    return {
        'path': str(filepath.relative_to(WORKSPACE)),
        'updated': updated,
        'days_old': days_old,
        'status': status,
        'has_frontmatter': has_frontmatter,
        'confidence': fm.get('confidence', 'unknown'),
        'version': fm.get('version', 'unknown')
    }

def scan_directory(directory: Path) -> list:
    """Scan a directory for markdown files."""
    results = []
    if not directory.exists():
        return results
    
    for filepath in directory.rglob('*.md'):
        if filepath.name.startswith('.'):
            continue
        results.append(check_file(filepath))
    
    return results

def main():
    all_results = []
    
    # Scan knowledge and procedures directories
    for dir_path in [KNOWLEDGE_DIR, PROCEDURES_DIR]:
        all_results.extend(scan_directory(dir_path))
    
    # Categorize results
    very_stale = [r for r in all_results if r.get('status') == 'very_stale']
    stale = [r for r in all_results if r.get('status') == 'stale']
    no_frontmatter = [r for r in all_results if not r.get('has_frontmatter', True)]
    current = [r for r in all_results if r.get('status') == 'current']
    
    # Output
    print("=== Wiki Staleness Check ===\n")
    
    if very_stale:
        print(f"[!!] VERY STALE ({len(very_stale)} files, >90 days):")
        for r in sorted(very_stale, key=lambda x: -x.get('days_old', 0)):
            print(f"   {r['path']} ({r['days_old']} days)")
    
    if stale:
        print(f"\n[!] STALE ({len(stale)} files, >30 days):")
        for r in sorted(stale, key=lambda x: -x.get('days_old', 0)):
            print(f"   {r['path']} ({r['days_old']} days)")
    
    if no_frontmatter:
        print(f"\n[i] NO FRONTMATTER ({len(no_frontmatter)} files):")
        for r in no_frontmatter[:10]:  # Limit output
            print(f"   {r['path']}")
        if len(no_frontmatter) > 10:
            print(f"   ... and {len(no_frontmatter) - 10} more")
    
    print(f"\n[OK] CURRENT: {len(current)} files")
    print(f"\nSUMMARY: {len(all_results)} files total")
    
    # Exit code based on findings
    if very_stale:
        print("\n[FAIL] Very stale files need urgent review")
        sys.exit(2)
    elif stale:
        print("\n[WARN] Stale files should be reviewed")
        sys.exit(1)
    else:
        print("\n[PASS] All wiki files are current")
        sys.exit(0)

if __name__ == "__main__":
    main()
