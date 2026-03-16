#!/usr/bin/env python3
"""
Task Claim Pool System
Manages priority scoring, agent claims, and parallel execution

Usage:
    python task-claim-pool.py status
    python task-claim-pool.py available --specialty research
    python task-claim-pool.py calculate-priorities
    python task-claim-pool.py claim --task-id T123 --agent-id subagent:abc --agent-name "Research Agent" --specialty research
    python task-claim-pool.py release --task-id T123 --agent-id subagent:abc
    python task-claim-pool.py heartbeat --agent-id subagent:abc
"""
import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

WORKSPACE = Path(__file__).parent.parent
TASKS_PATH = WORKSPACE / 'memory' / 'tasks.json'
PARALLEL_LOG = WORKSPACE / 'memory' / 'parallel-execution.jsonl'

def load_tasks():
    with open(TASKS_PATH, 'r', encoding='utf-8') as f:
        return json.load(f)

def save_tasks(data):
    data['version'] = data.get('version', 0) + 1
    data['updated_at'] = datetime.now(timezone.utc).isoformat()
    data['updated_by'] = 'task-claim-pool'
    with open(TASKS_PATH, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2)

def log_event(event):
    event['timestamp'] = datetime.now(timezone.utc).isoformat()
    with open(PARALLEL_LOG, 'a', encoding='utf-8') as f:
        f.write(json.dumps(event) + '\n')

def get_urgency_score(due_date):
    if not due_date:
        return 0
    try:
        due = datetime.fromisoformat(due_date.replace('Z', '+00:00'))
        now = datetime.now(timezone.utc)
        days_until = (due - now).days
        
        if days_until < 0: return 40   # Past due
        if days_until < 1: return 30   # Within 24h
        if days_until < 3: return 20   # Within 3 days
        if days_until < 7: return 10   # Within 7 days
        return 0
    except:
        return 0

def get_impact_score(impact):
    scores = {'critical': 40, 'high': 30, 'medium': 20, 'low': 10, 'none': 0}
    return scores.get(impact, 0)

def get_dependency_boost(blocks):
    if not blocks:
        return 0
    count = len(blocks)
    if count >= 3: return 20
    if count >= 1: return 10
    return 0

def get_priority_level(score):
    if score >= 80: return 'P0'
    if score >= 60: return 'P1'
    if score >= 40: return 'P2'
    if score >= 20: return 'P3'
    return 'P4'

def calculate_priorities():
    """Calculate priority scores for all tasks"""
    data = load_tasks()
    updated = 0
    
    for task_id, task in data.get('tasks', {}).items():
        status = task.get('status', 'pending')
        if status not in ['pending', 'in_progress', None]:
            continue
        
        # Get scores
        urgency = get_urgency_score(task.get('due_date'))
        impact_level = task.get('priority', {}).get('impact', 'medium')
        impact_score = get_impact_score(impact_level)
        dependency_boost = get_dependency_boost(task.get('blocks'))
        
        total_score = urgency + impact_score + dependency_boost
        priority_level = get_priority_level(total_score)
        
        # Update task
        if 'priority' not in task:
            task['priority'] = {}
        task['priority'].update({
            'urgency': urgency,
            'impact': impact_level,
            'impact_score': impact_score,
            'dependency_boost': dependency_boost,
            'total_score': total_score,
            'priority_level': priority_level,
            'calculated_at': datetime.now(timezone.utc).isoformat()
        })
        updated += 1
    
    save_tasks(data)
    print(f"Updated priorities for {updated} tasks")

def get_available_tasks(specialty):
    """Get available tasks for a specialty"""
    data = load_tasks()
    available = []
    
    for task_id in data.get('lanes', {}).get('bot_queue', []):
        task = data.get('tasks', {}).get(task_id)
        if not task:
            continue
        
        # Check if claimed
        claimed = task.get('claimed_by', {})
        if claimed.get('agent_id'):
            last_hb = claimed.get('last_heartbeat')
            if last_hb:
                try:
                    hb_time = datetime.fromisoformat(last_hb.replace('Z', '+00:00'))
                    mins_ago = (datetime.now(timezone.utc) - hb_time).total_seconds() / 60
                    if mins_ago < 30:
                        continue  # Still claimed
                except:
                    pass
        
        # Check specialty match
        required_agent = task.get('required_agent', 'general')
        if specialty != 'general' and required_agent != 'general' and required_agent != specialty:
            continue
        
        priority = task.get('priority', {}).get('total_score', 0)
        available.append({
            'task_id': task_id,
            'title': task.get('title', 'Unknown'),
            'required_agent': required_agent,
            'priority_score': priority,
            'priority_level': task.get('priority', {}).get('priority_level', 'P4')
        })
    
    # Sort by priority descending
    available.sort(key=lambda x: x['priority_score'], reverse=True)
    return available

def claim_task(task_id, agent_id, agent_name, specialty):
    """Claim a task"""
    data = load_tasks()
    
    if task_id not in data.get('tasks', {}):
        raise ValueError(f"Task {task_id} not found")
    
    task = data['tasks'][task_id]
    now = datetime.now(timezone.utc).isoformat()
    
    # Check if claimed
    claimed = task.get('claimed_by', {})
    if claimed.get('agent_id'):
        last_hb = claimed.get('last_heartbeat')
        if last_hb:
            try:
                hb_time = datetime.fromisoformat(last_hb.replace('Z', '+00:00'))
                mins_ago = (datetime.now(timezone.utc) - hb_time).total_seconds() / 60
                if mins_ago < 30:
                    raise ValueError(f"Task {task_id} already claimed by {claimed.get('agent_name')}")
            except ValueError:
                raise
    
    # Claim it
    task['claimed_by'] = {
        'agent_id': agent_id,
        'agent_name': agent_name,
        'specialty': specialty,
        'claimed_at': now,
        'last_heartbeat': now
    }
    task['status'] = 'in_progress'
    
    # Update parallel execution
    if 'parallel_execution' not in data:
        data['parallel_execution'] = {
            'enabled': True,
            'max_concurrent': 5,
            'active_agents': [],
            'claim_timeout_minutes': 30
        }
    
    # Add to active agents
    agents = data['parallel_execution'].get('active_agents', [])
    existing = [a for a in agents if a.get('agent_id') == agent_id]
    if not existing:
        agents.append({
            'agent_id': agent_id,
            'agent_name': agent_name,
            'specialty': specialty,
            'current_task': task_id,
            'started_at': now,
            'last_heartbeat': now
        })
    else:
        existing[0]['current_task'] = task_id
        existing[0]['last_heartbeat'] = now
    data['parallel_execution']['active_agents'] = agents
    
    save_tasks(data)
    log_event({
        'event': 'claim',
        'task_id': task_id,
        'agent_id': agent_id,
        'agent_name': agent_name,
        'specialty': specialty
    })
    
    print(f"Task {task_id} claimed by {agent_name} ({specialty})")

def release_task(task_id, agent_id, reason=''):
    """Release a task back to pool"""
    data = load_tasks()
    
    if task_id not in data.get('tasks', {}):
        raise ValueError(f"Task {task_id} not found")
    
    task = data['tasks'][task_id]
    claimed = task.get('claimed_by', {})
    
    if claimed.get('agent_id') != agent_id:
        raise ValueError(f"Task {task_id} not owned by agent {agent_id}")
    
    agent_name = claimed.get('agent_name', 'Unknown')
    
    # Release
    task['claimed_by'] = None
    task['status'] = 'pending'
    
    if reason:
        notes = task.get('notes', '')
        task['notes'] = f"{notes}\n[Released by {agent_name}]: {reason}".strip()
    
    # Remove from active agents
    if 'parallel_execution' in data:
        agents = data['parallel_execution'].get('active_agents', [])
        data['parallel_execution']['active_agents'] = [
            a for a in agents if a.get('agent_id') != agent_id
        ]
    
    save_tasks(data)
    log_event({
        'event': 'release',
        'task_id': task_id,
        'agent_id': agent_id,
        'reason': reason
    })
    
    print(f"Task {task_id} released back to pool")

def send_heartbeat(agent_id):
    """Send heartbeat to keep claim alive"""
    data = load_tasks()
    now = datetime.now(timezone.utc).isoformat()
    
    # Update tasks
    for task_id, task in data.get('tasks', {}).items():
        claimed = task.get('claimed_by', {})
        if claimed.get('agent_id') == agent_id:
            claimed['last_heartbeat'] = now
    
    # Update active agents
    if 'parallel_execution' in data:
        for agent in data['parallel_execution'].get('active_agents', []):
            if agent.get('agent_id') == agent_id:
                agent['last_heartbeat'] = now
    
    save_tasks(data)
    print(f"Heartbeat sent for agent {agent_id}")

def show_status():
    """Show current status"""
    data = load_tasks()
    
    print("\n=== Task Claim Pool Status ===")
    
    # Active agents
    pe = data.get('parallel_execution', {})
    agents = pe.get('active_agents', [])
    max_concurrent = pe.get('max_concurrent', 5)
    
    print(f"\nActive Agents: {len(agents)} / {max_concurrent}")
    
    for agent in agents:
        task = data.get('tasks', {}).get(agent.get('current_task', ''), {})
        task_title = task.get('title', 'Unknown')[:40]
        print(f"  - {agent.get('agent_name')} [{agent.get('specialty')}]: {agent.get('current_task')} - {task_title}")
    
    if not agents:
        print("  (no active agents)")
    
    # Queue by specialty
    print("\nQueue by Specialty:")
    by_specialty = {}
    for task_id in data.get('lanes', {}).get('bot_queue', []):
        task = data.get('tasks', {}).get(task_id)
        if not task:
            continue
        spec = task.get('required_agent', 'general')
        by_specialty[spec] = by_specialty.get(spec, 0) + 1
    
    for spec in sorted(by_specialty.keys()):
        print(f"  - {spec}: {by_specialty[spec]} tasks")
    
    if not by_specialty:
        print("  (queue empty)")
    
    # Priority distribution
    print("\nPriority Distribution:")
    by_priority = {'P0': 0, 'P1': 0, 'P2': 0, 'P3': 0, 'P4': 0}
    for task_id in data.get('lanes', {}).get('bot_queue', []):
        task = data.get('tasks', {}).get(task_id)
        if not task:
            continue
        level = task.get('priority', {}).get('priority_level', 'P4')
        by_priority[level] = by_priority.get(level, 0) + 1
    
    for p in ['P0', 'P1', 'P2', 'P3', 'P4']:
        print(f"  - {p}: {by_priority[p]} tasks")

def main():
    parser = argparse.ArgumentParser(description='Task Claim Pool System')
    parser.add_argument('action', choices=['status', 'available', 'calculate-priorities', 'claim', 'release', 'heartbeat'])
    parser.add_argument('--task-id', help='Task ID')
    parser.add_argument('--agent-id', help='Agent ID')
    parser.add_argument('--agent-name', help='Agent name')
    parser.add_argument('--specialty', default='general', 
                        choices=['research', 'content', 'audit', 'analytics', 'code', 'general'])
    parser.add_argument('--reason', default='', help='Release reason')
    
    args = parser.parse_args()
    
    if args.action == 'status':
        show_status()
    elif args.action == 'available':
        available = get_available_tasks(args.specialty)
        print(f"\n=== Available Tasks for '{args.specialty}' ===")
        for t in available:
            print(f"[{t['priority_level']}] {t['task_id']}: {t['title']} (Score: {t['priority_score']}, Requires: {t['required_agent']})")
        if not available:
            print(f"No tasks available for specialty: {args.specialty}")
    elif args.action == 'calculate-priorities':
        calculate_priorities()
    elif args.action == 'claim':
        if not args.task_id or not args.agent_id or not args.agent_name:
            parser.error("claim requires --task-id, --agent-id, --agent-name")
        claim_task(args.task_id, args.agent_id, args.agent_name, args.specialty)
    elif args.action == 'release':
        if not args.task_id or not args.agent_id:
            parser.error("release requires --task-id, --agent-id")
        release_task(args.task_id, args.agent_id, args.reason)
    elif args.action == 'heartbeat':
        if not args.agent_id:
            parser.error("heartbeat requires --agent-id")
        send_heartbeat(args.agent_id)

if __name__ == '__main__':
    main()
