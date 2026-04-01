#!/usr/bin/env python3
"""Update tasks.json with Task Claim Pool schema"""
import json
from datetime import datetime, timezone

TASKS_PATH = 'memory/tasks.json'

# Read tasks.json
with open(TASKS_PATH, 'r', encoding='utf-8') as f:
    data = json.load(f)

# Add parallel_execution tracking
if 'parallel_execution' not in data:
    data['parallel_execution'] = {
        'enabled': True,
        'max_concurrent': 5,
        'active_agents': [],
        'claim_timeout_minutes': 30
    }

# Update notes
data['notes'] = 'Version 7: Added Task Claim Pool system. Tasks can have required_agent (research/content/audit/analytics/code/general), priority scoring (urgency + impact + dependency_boost), and parallel execution tracking. See procedures/task-claim-pool.md for details.'

# Increment version
data['version'] = data.get('version', 0) + 1
data['updated_at'] = datetime.now(timezone.utc).isoformat()

# Save
with open(TASKS_PATH, 'w', encoding='utf-8') as f:
    json.dump(data, f, indent=2)

print(f"Updated tasks.json with parallel_execution field (version {data['version']})")
