#!/usr/bin/env python3
"""
Task Discussion Auto-Capture (T199)
Detects T### mentions in messages and appends to task discussions.

Usage:
    python task-discussion-capture.py --task T123 --author bot --message "Working on this now"
    python task-discussion-capture.py --detect "I'm starting T123 and T456" --author human --message "..."
"""

import argparse
import json
import re
from datetime import datetime
from pathlib import Path

TASKS_FILE = Path("C:/dev/FsuelsBot/workspace/memory/tasks.json")

def detect_task_ids(text: str) -> list:
    """Extract all T### task IDs from text."""
    pattern = r'\bT(\d{3})\b'
    matches = re.findall(pattern, text)
    return [f"T{m}" for m in matches]

def append_to_discussion(task_id: str, author: str, message: str) -> bool:
    """Append a comment to a task's discussion array."""
    if not TASKS_FILE.exists():
        print(f"ERROR: {TASKS_FILE} not found")
        return False
    
    with open(TASKS_FILE, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    if task_id not in data.get('tasks', {}):
        print(f"ERROR: Task {task_id} not found")
        return False
    
    task = data['tasks'][task_id]
    
    # Initialize discussion if missing
    if 'discussion' not in task:
        task['discussion'] = []
    
    # Get next event_id
    existing_ids = [c.get('event_id', 0) for c in task['discussion']]
    next_id = max(existing_ids, default=0) + 1
    
    # Create comment
    comment = {
        'event_id': next_id,
        'ts': datetime.now().isoformat(),
        'author': author,
        'message': message
    }
    
    task['discussion'].append(comment)
    data['version'] = data.get('version', 0) + 1
    data['updated_at'] = datetime.now().isoformat()
    
    with open(TASKS_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2)
    
    print(f"OK: Added comment #{next_id} to {task_id}")
    return True

def main():
    parser = argparse.ArgumentParser(description='Task Discussion Auto-Capture')
    parser.add_argument('--task', help='Specific task ID to add comment to')
    parser.add_argument('--detect', help='Text to scan for T### mentions')
    parser.add_argument('--author', required=True, choices=['human', 'bot'], help='Comment author')
    parser.add_argument('--message', required=True, help='Message to add')
    
    args = parser.parse_args()
    
    if args.detect:
        # Auto-detect mode: find all task IDs in text
        task_ids = detect_task_ids(args.detect)
        if not task_ids:
            print("NO_TASKS: No T### patterns found in text")
            return
        
        for tid in task_ids:
            append_to_discussion(tid, args.author, args.message)
    
    elif args.task:
        # Direct mode: add to specific task
        append_to_discussion(args.task, args.author, args.message)
    
    else:
        parser.error("Either --task or --detect must be provided")

if __name__ == '__main__':
    main()
