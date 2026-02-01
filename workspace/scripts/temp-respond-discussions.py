import json
from datetime import datetime

with open('memory/tasks.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

# Add bot response to T180 discussion
if 'discussion' not in data['tasks']['T180']:
    data['tasks']['T180']['discussion'] = []

data['tasks']['T180']['discussion'].append({
    'event_id': len(data['tasks']['T180']['discussion']) + 1,
    'ts': datetime.now().isoformat(),
    'author': 'bot',
    'message': 'Saw your comment! Mobile problem still exists - checking now and will fix properly. Going to browser to debug.'
})

# Add bot response to T174 discussion  
if 'discussion' not in data['tasks']['T174']:
    data['tasks']['T174']['discussion'] = []

data['tasks']['T174']['discussion'].append({
    'event_id': len(data['tasks']['T174']['discussion']) + 1,
    'ts': datetime.now().isoformat(),
    'author': 'bot',
    'message': "You're right - I should do DMs and Discord myself! I have the outreach templates ready. Starting X DMs now via browser. For Discord, checking if I have access to post."
})

# Update T174 steps - remove "waiting for human"
for step in data['tasks']['T174']['steps']:
    if 'Direct outreach' in step.get('step', ''):
        step['status'] = 'in_progress'
        step['waiting_for'] = None
    if 'Moltbook Discord' in step.get('step', ''):
        step['status'] = 'in_progress'
        step['waiting_for'] = None

data['version'] = data['version'] + 1

with open('memory/tasks.json', 'w', encoding='utf-8') as f:
    json.dump(data, f, indent=2, ensure_ascii=False)

print('Responded to T180 and T174 discussions')
