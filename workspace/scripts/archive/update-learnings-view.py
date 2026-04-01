#!/usr/bin/env python3
"""
update-learnings-view.py
Update learnings.db view to use is_pinned DESC, last_accessed_at DESC
Council T123 verdict implementation
"""

import sqlite3
from pathlib import Path

DB_PATH = Path(r"C:\dev\FsuelsBot\workspace\memory\learnings.db")

def main():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    
    # 1. Drop and recreate the active_learnings view with new ORDER BY
    cur.execute('DROP VIEW IF EXISTS active_learnings')
    cur.execute("""
        CREATE VIEW active_learnings AS
        SELECT * FROM learning 
        WHERE is_active = 1 
          AND (expires_at IS NULL OR expires_at > datetime('now'))
        ORDER BY is_pinned DESC, last_accessed_at DESC NULLS LAST, updated_at DESC
    """)
    print('[OK] View updated: ORDER BY is_pinned DESC, last_accessed_at DESC')
    
    # 2. Add index on last_accessed_at for performance
    cur.execute('CREATE INDEX IF NOT EXISTS idx_learning_last_accessed ON learning(last_accessed_at)')
    print('[OK] Index added: idx_learning_last_accessed')
    
    # 3. Initialize last_accessed_at for existing records that don't have it
    cur.execute("""
        UPDATE learning 
        SET last_accessed_at = updated_at 
        WHERE last_accessed_at IS NULL
    """)
    updated = cur.rowcount
    print(f'[OK] Initialized last_accessed_at for {updated} records')
    
    conn.commit()
    conn.close()
    
    print('\n[DONE] Memory decay (pin + recency sort) implemented!')

if __name__ == "__main__":
    main()
