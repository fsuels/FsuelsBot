#!/usr/bin/env python3
"""
check-contradiction.py
Checks for potential contradictions before adding to learnings.db

ROUND 2 Epistemic Improvement: Detect kettle logic fallacy
"""

import sqlite3
import sys
import hashlib
import json
from pathlib import Path

WORKSPACE = Path(r"C:\dev\FsuelsBot\workspace")
DB_PATH = WORKSPACE / "memory" / "learnings.db"

# Contradiction keywords that might indicate conflicting statements
NEGATION_PAIRS = [
    ("always", "never"),
    ("must", "must not"),
    ("should", "should not"),
    ("is", "is not"),
    ("does", "does not"),
    ("can", "cannot"),
    ("will", "will not"),
    ("true", "false"),
    ("yes", "no"),
    ("required", "optional"),
    ("mandatory", "forbidden"),
]

def normalize_statement(s):
    """Normalize for comparison"""
    return s.lower().strip()

def extract_key_terms(statement):
    """Extract key terms for matching"""
    # Remove common words
    stopwords = {'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
                 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
                 'should', 'may', 'might', 'must', 'shall', 'can', 'to', 'of', 'in',
                 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through'}
    words = normalize_statement(statement).split()
    return set(w for w in words if w not in stopwords and len(w) > 2)

def find_potential_contradictions(new_statement, entity=None):
    """Find existing learnings that might contradict the new statement"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    
    # Get active learnings
    query = "SELECT * FROM learning WHERE is_active = 1"
    params = []
    if entity:
        query += " AND entity = ?"
        params.append(entity)
    
    existing = conn.execute(query, params).fetchall()
    conn.close()
    
    new_terms = extract_key_terms(new_statement)
    new_normalized = normalize_statement(new_statement)
    
    potential_conflicts = []
    
    for row in existing:
        old_statement = row['statement']
        old_normalized = normalize_statement(old_statement)
        old_terms = extract_key_terms(old_statement)
        
        # Check term overlap (same topic)
        overlap = new_terms & old_terms
        if len(overlap) < 2:
            continue  # Not enough overlap to be about same thing
        
        # Check for negation pairs
        for pos, neg in NEGATION_PAIRS:
            if (pos in new_normalized and neg in old_normalized) or \
               (neg in new_normalized and pos in old_normalized):
                potential_conflicts.append({
                    'id': row['id'],
                    'statement': old_statement,
                    'overlap': list(overlap),
                    'reason': f"Negation pair detected: {pos}/{neg}",
                    'confidence': row['confidence']
                })
                break
    
    return potential_conflicts

def main():
    if len(sys.argv) < 2:
        print("Usage: check-contradiction.py \"new statement\" [entity]")
        print("\nChecks for potential contradictions before adding to learnings.db")
        sys.exit(1)
    
    new_statement = sys.argv[1]
    entity = sys.argv[2] if len(sys.argv) > 2 else None
    
    print(f"=== Contradiction Check ===")
    print(f"New statement: {new_statement}")
    if entity:
        print(f"Entity: {entity}")
    print()
    
    conflicts = find_potential_contradictions(new_statement, entity)
    
    if not conflicts:
        print("[OK] No potential contradictions found")
        print("Safe to add to learnings.db")
        sys.exit(0)
    else:
        print(f"[!] Found {len(conflicts)} potential contradiction(s):")
        print()
        for c in conflicts:
            print(f"  ID {c['id']}: {c['statement']}")
            print(f"    Overlap: {', '.join(c['overlap'])}")
            print(f"    Reason: {c['reason']}")
            print(f"    Confidence: {c['confidence']}")
            print()
        print("Review before adding. Consider:")
        print("1. Is the old statement still true?")
        print("2. Should the old statement be superseded?")
        print("3. Are both statements true in different contexts?")
        sys.exit(1)

if __name__ == "__main__":
    main()
