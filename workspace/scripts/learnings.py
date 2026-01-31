#!/usr/bin/env python3
"""
learnings.py
Manage learnings in SQLite database
Council A+ requirement #4

Usage:
  python learnings.py add --kind fact --statement "..." [--tags "a,b,c"] [--entity "..."] [--pinned]
  python learnings.py list [--kind fact] [--active-only] [--limit 50]
  python learnings.py search "query"
  python learnings.py prune [--dry-run]
  python learnings.py export [--format json|md]
  python learnings.py stats
"""

import sqlite3
import hashlib
import json
import re
import sys
from datetime import datetime, timedelta
from pathlib import Path

WORKSPACE = Path(r"C:\dev\FsuelsBot\workspace")
DB_PATH = WORKSPACE / "memory" / "learnings.db"

def get_db():
    return sqlite3.connect(DB_PATH, detect_types=sqlite3.PARSE_DECLTYPES)

def canonicalize(statement: str) -> str:
    """Normalize statement for deduplication hash."""
    # Lowercase, strip, remove extra whitespace
    s = statement.lower().strip()
    s = re.sub(r'\s+', ' ', s)
    # Remove common filler words that don't change meaning
    s = re.sub(r'\b(the|a|an|is|are|was|were|be|been|being)\b', '', s)
    s = re.sub(r'\s+', ' ', s).strip()
    return hashlib.sha256(s.encode()).hexdigest()

def add_learning(statement: str, kind: str, tags: list = None, entity: str = None, 
                 source: str = None, pinned: bool = False, confidence: float = 0.8,
                 expires_days: int = None):
    """Add a learning with deduplication."""
    canonical_hash = canonicalize(statement)
    
    conn = get_db()
    cur = conn.cursor()
    
    # Check for duplicate
    cur.execute("SELECT id, statement FROM learning WHERE canonical_hash = ?", (canonical_hash,))
    existing = cur.fetchone()
    
    if existing:
        # Update timestamp and confidence boost
        cur.execute("""
            UPDATE learning 
            SET updated_at = datetime('now'),
                confidence = MIN(1.0, confidence + 0.1),
                last_accessed_at = datetime('now')
            WHERE id = ?
        """, (existing[0],))
        conn.commit()
        conn.close()
        print(f"[DUPLICATE] Learning already exists (id={existing[0]}), boosted confidence")
        return existing[0]
    
    # Insert new learning
    tags_json = json.dumps(tags or [])
    expires_at = None
    if expires_days:
        expires_at = (datetime.now() + timedelta(days=expires_days)).isoformat()
    
    cur.execute("""
        INSERT INTO learning (statement, kind, canonical_hash, tags, entity, source, 
                             is_pinned, confidence, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (statement, kind, canonical_hash, tags_json, entity, source, 
          1 if pinned else 0, confidence, expires_at))
    
    learning_id = cur.lastrowid
    conn.commit()
    conn.close()
    
    print(f"[ADDED] Learning id={learning_id}, kind={kind}")
    return learning_id

def list_learnings(kind: str = None, active_only: bool = True, limit: int = 50):
    """List learnings with optional filters. Updates last_accessed_at for retrieved items."""
    conn = get_db()
    cur = conn.cursor()
    
    query = "SELECT id, statement, kind, confidence, is_pinned, created_at FROM "
    query += "active_learnings" if active_only else "learning"
    
    params = []
    if kind:
        query += " WHERE kind = ?"
        params.append(kind)
    
    query += f" LIMIT {limit}"
    
    cur.execute(query, params)
    rows = cur.fetchall()
    
    # Update last_accessed_at for retrieved items (Council T123 verdict)
    if rows:
        ids = [row[0] for row in rows]
        placeholders = ','.join('?' * len(ids))
        cur.execute(f"UPDATE learning SET last_accessed_at = datetime('now') WHERE id IN ({placeholders})", ids)
        conn.commit()
    
    conn.close()
    
    print(f"=== Learnings ({len(rows)} results) ===")
    for row in rows:
        pinned = "[P]" if row[4] else "   "
        print(f"{pinned} [{row[0]:4d}] ({row[2]:12s}, {row[3]:.1f}) {row[1][:60]}...")
    
    return rows

def search_learnings(query: str, limit: int = 20):
    """Simple search in statements. Updates last_accessed_at for retrieved items."""
    conn = get_db()
    cur = conn.cursor()
    
    cur.execute("""
        SELECT id, statement, kind, confidence, is_pinned 
        FROM active_learnings 
        WHERE statement LIKE ?
        LIMIT ?
    """, (f"%{query}%", limit))
    
    rows = cur.fetchall()
    
    # Update last_accessed_at for retrieved items (Council T123 verdict)
    if rows:
        ids = [row[0] for row in rows]
        placeholders = ','.join('?' * len(ids))
        cur.execute(f"UPDATE learning SET last_accessed_at = datetime('now') WHERE id IN ({placeholders})", ids)
        conn.commit()
    
    conn.close()
    
    print(f"=== Search results for '{query}' ({len(rows)} matches) ===")
    for row in rows:
        pinned = "[P]" if row[4] else "   "
        print(f"{pinned} [{row[0]:4d}] ({row[2]:12s}) {row[1][:60]}...")
    
    return rows

def prune_learnings(dry_run: bool = True):
    """Remove expired and low-confidence learnings."""
    conn = get_db()
    cur = conn.cursor()
    
    # Find prunable learnings (not pinned, expired or low confidence)
    cur.execute("""
        SELECT id, statement, kind, confidence, expires_at
        FROM learning
        WHERE is_active = 1
          AND is_pinned = 0
          AND (
              (expires_at IS NOT NULL AND expires_at < datetime('now'))
              OR (confidence < 0.3 AND updated_at < datetime('now', '-7 days'))
          )
    """)
    
    to_prune = cur.fetchall()
    
    print(f"=== Pruning {'(DRY RUN)' if dry_run else ''} ===")
    print(f"Found {len(to_prune)} learnings to prune")
    
    for row in to_prune:
        print(f"  [{row[0]}] ({row[2]}, conf={row[3]:.1f}) {row[1][:50]}...")
    
    if not dry_run and to_prune:
        ids = [r[0] for r in to_prune]
        placeholders = ','.join('?' * len(ids))
        cur.execute(f"UPDATE learning SET is_active = 0 WHERE id IN ({placeholders})", ids)
        conn.commit()
        print(f"Pruned {len(to_prune)} learnings (soft delete)")
    
    conn.close()
    return len(to_prune)

def export_learnings(format: str = "json"):
    """Export active learnings."""
    conn = get_db()
    cur = conn.cursor()
    
    cur.execute("SELECT * FROM active_learnings")
    columns = [d[0] for d in cur.description]
    rows = cur.fetchall()
    conn.close()
    
    if format == "json":
        data = [dict(zip(columns, row)) for row in rows]
        print(json.dumps(data, indent=2, default=str))
    else:  # markdown
        print("# Active Learnings\n")
        for row in rows:
            d = dict(zip(columns, row))
            pinned = " [PINNED]" if d['is_pinned'] else ""
            print(f"## [{d['id']}] {d['kind'].upper()}{pinned}")
            print(f"> {d['statement']}")
            print(f"- Confidence: {d['confidence']:.1%}")
            print(f"- Created: {d['created_at']}")
            if d['tags'] and d['tags'] != '[]':
                print(f"- Tags: {d['tags']}")
            print()

def stats():
    """Show learning statistics."""
    conn = get_db()
    cur = conn.cursor()
    
    print("=== Learning Statistics ===")
    
    cur.execute("SELECT COUNT(*) FROM learning")
    total = cur.fetchone()[0]
    print(f"Total learnings: {total}")
    
    cur.execute("SELECT COUNT(*) FROM learning WHERE is_active = 1")
    active = cur.fetchone()[0]
    print(f"Active: {active}")
    
    cur.execute("SELECT COUNT(*) FROM learning WHERE is_pinned = 1")
    pinned = cur.fetchone()[0]
    print(f"Pinned (P0): {pinned}")
    
    print("\nBy kind:")
    cur.execute("SELECT kind, COUNT(*) FROM learning WHERE is_active = 1 GROUP BY kind")
    for row in cur.fetchall():
        print(f"  {row[0]:12s}: {row[1]}")
    
    print("\nConfidence distribution:")
    cur.execute("""
        SELECT 
            CASE 
                WHEN confidence >= 0.8 THEN 'high (0.8+)'
                WHEN confidence >= 0.5 THEN 'medium (0.5-0.8)'
                ELSE 'low (<0.5)'
            END as bracket,
            COUNT(*)
        FROM learning WHERE is_active = 1
        GROUP BY bracket
    """)
    for row in cur.fetchall():
        print(f"  {row[0]:15s}: {row[1]}")
    
    conn.close()

def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return
    
    cmd = sys.argv[1]
    
    if cmd == "add":
        # Parse args
        kind = None
        statement = None
        tags = []
        entity = None
        source = None
        pinned = False
        
        i = 2
        while i < len(sys.argv):
            if sys.argv[i] == "--kind" and i+1 < len(sys.argv):
                kind = sys.argv[i+1]
                i += 2
            elif sys.argv[i] == "--statement" and i+1 < len(sys.argv):
                statement = sys.argv[i+1]
                i += 2
            elif sys.argv[i] == "--tags" and i+1 < len(sys.argv):
                tags = sys.argv[i+1].split(",")
                i += 2
            elif sys.argv[i] == "--entity" and i+1 < len(sys.argv):
                entity = sys.argv[i+1]
                i += 2
            elif sys.argv[i] == "--source" and i+1 < len(sys.argv):
                source = sys.argv[i+1]
                i += 2
            elif sys.argv[i] == "--pinned":
                pinned = True
                i += 1
            else:
                i += 1
        
        if not kind or not statement:
            print("Usage: python learnings.py add --kind <kind> --statement \"...\"")
            return
        
        add_learning(statement, kind, tags, entity, source, pinned)
    
    elif cmd == "list":
        kind = None
        limit = 50
        for i, arg in enumerate(sys.argv[2:], 2):
            if arg == "--kind" and i+1 < len(sys.argv):
                kind = sys.argv[i+1]
            elif arg == "--limit" and i+1 < len(sys.argv):
                limit = int(sys.argv[i+1])
        list_learnings(kind=kind, limit=limit)
    
    elif cmd == "search" and len(sys.argv) > 2:
        search_learnings(sys.argv[2])
    
    elif cmd == "prune":
        dry_run = "--dry-run" in sys.argv
        prune_learnings(dry_run=dry_run)
    
    elif cmd == "export":
        fmt = "json"
        if "--format" in sys.argv:
            idx = sys.argv.index("--format")
            if idx + 1 < len(sys.argv):
                fmt = sys.argv[idx + 1]
        export_learnings(fmt)
    
    elif cmd == "stats":
        stats()
    
    else:
        print(__doc__)

if __name__ == "__main__":
    main()
