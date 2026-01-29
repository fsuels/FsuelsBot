#!/usr/bin/env python3
"""
add-frontmatter-bulk.py — Add frontmatter to all markdown files without it
"""

import os
from pathlib import Path
from datetime import datetime

WORKSPACE = Path(r"C:\dev\FsuelsBot\workspace")
DIRS_TO_PROCESS = [
    WORKSPACE / "procedures",
    WORKSPACE / "knowledge",
]

def has_frontmatter(content: str) -> bool:
    """Check if content has YAML frontmatter."""
    return content.strip().startswith('---')

def add_frontmatter(filepath: Path) -> bool:
    """Add frontmatter to a file if it doesn't have one."""
    try:
        content = filepath.read_text(encoding='utf-8')
    except Exception as e:
        print(f"Error reading {filepath}: {e}")
        return False
    
    if has_frontmatter(content):
        return False  # Already has frontmatter
    
    # Generate frontmatter
    today = datetime.now().strftime('%Y-%m-%d')
    
    # Determine confidence based on directory
    rel_path = str(filepath.relative_to(WORKSPACE))
    if 'procedures' in rel_path:
        confidence = 'high'
        doc_type = 'procedure'
    elif 'insights' in rel_path:
        confidence = 'medium'
        doc_type = 'insight'
    elif 'principles' in rel_path:
        confidence = 'high'
        doc_type = 'principle'
    elif 'entities' in rel_path:
        confidence = 'medium'
        doc_type = 'entity'
    else:
        confidence = 'medium'
        doc_type = 'knowledge'
    
    frontmatter = f'''---
version: "1.0"
created: "{today}"
updated: "{today}"
verified: "{today}"
confidence: "{confidence}"
type: "{doc_type}"
---

'''
    
    new_content = frontmatter + content
    
    try:
        filepath.write_text(new_content, encoding='utf-8')
        return True
    except Exception as e:
        print(f"Error writing {filepath}: {e}")
        return False

def main():
    total_added = 0
    
    for dir_path in DIRS_TO_PROCESS:
        if not dir_path.exists():
            continue
        
        for filepath in dir_path.rglob('*.md'):
            if filepath.name.startswith('.'):
                continue
            
            if add_frontmatter(filepath):
                print(f"Added: {filepath.relative_to(WORKSPACE)}")
                total_added += 1
    
    print(f"\nTotal files updated: {total_added}")

if __name__ == "__main__":
    main()
