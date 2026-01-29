#!/usr/bin/env python3
"""
validate-frontmatter.py — Council A+ requirement for Wiki Versioning
Validates YAML frontmatter schema in knowledge/procedures files.
"""

import os
import re
import sys
from pathlib import Path
from datetime import datetime

WORKSPACE = Path(r"C:\dev\FsuelsBot\workspace")

# Council A+: Schema definition for frontmatter
FRONTMATTER_SCHEMA = {
    "required": [],  # Flexible - at minimum should have some date field
    "recommended": ["updated"],  # Preferred but not required
    "optional": [
        "version", "confidence", "verified_on", "author", "tags", "status", 
        "last_updated", "updated", "created", "verified", "type", "source",
        "priority", "category", "related", "expires"
    ],
    "types": {
        "updated": "date",
        "last_updated": "date",
        "verified_on": "date",
        "created": "date",
        "verified": "date",
        "expires": "date",
        "version": "string",
        "confidence": ["high", "medium", "low", "unknown"],
        "status": ["active", "draft", "deprecated", "archived"],
        "type": "string",
        "author": "string",
        "source": "string",
        "priority": "string",
        "category": "string",
        "tags": "list",
        "related": "list"
    }
}

def parse_frontmatter(content: str) -> dict:
    """Extract frontmatter from markdown file."""
    if not content.startswith('---'):
        return None
    
    try:
        end = content.index('---', 3)
        frontmatter = content[3:end].strip()
        
        result = {}
        for line in frontmatter.split('\n'):
            if ':' in line:
                key, value = line.split(':', 1)
                value = value.strip().strip('"').strip("'")
                result[key.strip()] = value
        return result
    except ValueError:
        return None

def validate_date(value: str) -> bool:
    """Validate date format YYYY-MM-DD."""
    try:
        datetime.strptime(value.split()[0], '%Y-%m-%d')
        return True
    except ValueError:
        return False

def validate_frontmatter(fm: dict, filepath: str) -> list:
    """Validate frontmatter against schema. Returns list of errors."""
    errors = []
    warnings = []
    
    if fm is None:
        errors.append(f"{filepath}: Missing frontmatter (no --- block)")
        return errors
    
    # Check required fields
    for field in FRONTMATTER_SCHEMA["required"]:
        if field not in fm:
            errors.append(f"{filepath}: Missing required field '{field}'")
    
    # Check for at least one date field (recommended)
    date_fields = ["updated", "last_updated", "verified_on", "created", "verified"]
    has_date = any(f in fm for f in date_fields)
    if not has_date:
        errors.append(f"{filepath}: No date field found (need at least one of: {date_fields})")
    
    # Check unknown fields
    all_known = set(FRONTMATTER_SCHEMA["required"] + FRONTMATTER_SCHEMA["optional"])
    for field in fm.keys():
        if field not in all_known:
            errors.append(f"{filepath}: Unknown field '{field}' (typo?)")
    
    # Validate types
    for field, expected_type in FRONTMATTER_SCHEMA["types"].items():
        if field not in fm:
            continue
            
        value = fm[field]
        
        if expected_type == "date":
            if not validate_date(value):
                errors.append(f"{filepath}: Field '{field}' must be YYYY-MM-DD format, got '{value}'")
        
        elif isinstance(expected_type, list):
            if value.lower() not in [v.lower() for v in expected_type]:
                errors.append(f"{filepath}: Field '{field}' must be one of {expected_type}, got '{value}'")
    
    return errors

def scan_directory(directory: Path) -> tuple:
    """Scan a directory for markdown files. Returns (valid_count, errors)."""
    all_errors = []
    valid = 0
    total = 0
    
    if not directory.exists():
        return 0, []
    
    for filepath in directory.rglob('*.md'):
        if filepath.name.startswith('.'):
            continue
        
        total += 1
        try:
            content = filepath.read_text(encoding='utf-8')
            fm = parse_frontmatter(content)
            errors = validate_frontmatter(fm, str(filepath.relative_to(WORKSPACE)))
            
            if errors:
                all_errors.extend(errors)
            else:
                valid += 1
        except Exception as e:
            all_errors.append(f"{filepath}: Read error: {e}")
    
    return valid, total, all_errors

def main():
    print("=== Frontmatter Schema Validation (Council A+) ===\n")
    
    dirs_to_check = [
        WORKSPACE / "knowledge",
        WORKSPACE / "procedures"
    ]
    
    total_valid = 0
    total_files = 0
    all_errors = []
    
    for dir_path in dirs_to_check:
        if dir_path.exists():
            valid, total, errors = scan_directory(dir_path)
            total_valid += valid
            total_files += total
            all_errors.extend(errors)
            print(f"{dir_path.name}/: {valid}/{total} valid")
    
    print()
    
    if all_errors:
        print(f"[!!] VALIDATION ERRORS ({len(all_errors)}):")
        for err in all_errors[:20]:  # Limit output
            print(f"  - {err}")
        if len(all_errors) > 20:
            print(f"  ... and {len(all_errors) - 20} more")
        print()
        print(f"[FAIL] {total_valid}/{total_files} files pass schema validation")
        sys.exit(1)
    else:
        print(f"[PASS] All {total_files} files pass schema validation")
        sys.exit(0)

if __name__ == "__main__":
    main()
