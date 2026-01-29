#!/usr/bin/env python3
"""
Add frontmatter to existing markdown files that lack it.
Council-designed: Grade A — Wiki versioning migration tool
Run once during migration, then as needed for new files.
"""

import os
import sys
from datetime import date
from pathlib import Path

WORKSPACE = Path(r"C:\dev\FsuelsBot\workspace")
KNOWLEDGE_DIR = WORKSPACE / "knowledge"

TEMPLATE = """---
version: "1.0"
created: "{created}"
updated: "{created}"
verified: "{created}"
confidence: "medium"
---

"""

def needs_frontmatter(path):
    """Check if file lacks frontmatter."""
    try:
        with open(path, 'r', encoding='utf-8') as f:
            content = f.read()
        return not content.strip().startswith('---')
    except:
        return False

def add_frontmatter(path):
    """Add frontmatter to file."""
    # Use file modification time as created date, or today
    try:
        mtime = os.path.getmtime(path)
        created = date.fromtimestamp(mtime).isoformat()
    except:
        created = date.today().isoformat()
    
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    frontmatter = TEMPLATE.format(created=created)
    
    with open(path, 'w', encoding='utf-8') as f:
        f.write(frontmatter + content)
    
    print(f"Added frontmatter to: {path.relative_to(WORKSPACE)}")
    return True

def main():
    if not KNOWLEDGE_DIR.exists():
        print(f"Knowledge directory not found: {KNOWLEDGE_DIR}")
        return 1
    
    count = 0
    for path in KNOWLEDGE_DIR.rglob("*.md"):
        if path.name in ['review-queue.md', 'README.md']:
            continue
        if '.archive' in str(path):
            continue
        
        if needs_frontmatter(path):
            add_frontmatter(path)
            count += 1
    
    print(f"\nAdded frontmatter to {count} files")
    return 0

if __name__ == "__main__":
    sys.exit(main())
