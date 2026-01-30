#!/usr/bin/env python3
"""
Cron-to-Task System
Creates a task card in tasks.json when a cron job fires.
Usage: python cron-to-task.py --job-id <cron-job-id> --title "Task Title" --instructions "What to do"

This ensures:
1. Every cron job creates a visible task card
2. Task appears in bot queue in Mission Control
3. Bot executes and fills in learnings when done
4. Full traceability of what each cron produced
"""

import json
import argparse
import os
from datetime import datetime, timezone

TASKS_FILE = os.path.join(os.path.dirname(__file__), "..", "memory", "tasks.json")

def create_cron_task(job_id: str, title: str, instructions: str, plan: str = None):
    """Create a task from a cron job trigger."""
    
    # Generate task ID with date
    date_str = datetime.now().strftime("%Y%m%d")
    task_id = f"CRON-{date_str}-{job_id}"
    
    # Load current tasks
    with open(TASKS_FILE, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    # Check if task already exists (idempotency - don't create duplicates)
    if task_id in data.get('tasks', {}):
        print(f"SKIP: Task {task_id} already exists (idempotent)")
        return task_id
    
    # Create the task
    task = {
        "title": title,
        "status": "pending",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "created_by": "cron",
        "cron_job_id": job_id,
        "instructions": instructions,
        "context": {
            "summary": f"Scheduled task from cron job '{job_id}'. Auto-created at scheduled time.",
            "created_from": f"cron:{job_id}",
            "decisions": [],
            "constraints": ["Must complete and log learnings before marking done"]
        },
        "learnings": {
            "question": f"What did {title} produce?",
            "verdict": None,  # Bot fills this in when complete
            "outcomes": [],   # Bot fills this in
            "actionsTaken": [],  # Bot fills this in
            "artifacts": []   # Bot fills this in
        }
    }
    
    if plan:
        task["plan"] = plan
    
    # Add to tasks
    if 'tasks' not in data:
        data['tasks'] = {}
    data['tasks'][task_id] = task
    
    # Add to bot_queue (will be picked up by bot)
    if 'lanes' not in data:
        data['lanes'] = {}
    if 'bot_queue' not in data['lanes']:
        data['lanes']['bot_queue'] = []
    
    # Add at front of queue (cron tasks are time-sensitive)
    data['lanes']['bot_queue'].insert(0, task_id)
    
    # Update metadata
    data['updated_at'] = datetime.now(timezone.utc).isoformat()
    data['updated_by'] = 'cron-to-task'
    
    # Save
    with open(TASKS_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    
    print(f"CREATED: Task {task_id} added to bot_queue")
    print(f"  Title: {title}")
    print(f"  Instructions: {instructions[:100]}...")
    
    return task_id


def main():
    parser = argparse.ArgumentParser(description="Create task from cron job")
    parser.add_argument("--job-id", required=True, help="Cron job identifier")
    parser.add_argument("--title", required=True, help="Task title")
    parser.add_argument("--instructions", required=True, help="What the bot should do")
    parser.add_argument("--plan", help="Optional plan document path")
    
    args = parser.parse_args()
    
    create_cron_task(
        job_id=args.job_id,
        title=args.title,
        instructions=args.instructions,
        plan=args.plan
    )


if __name__ == "__main__":
    main()
