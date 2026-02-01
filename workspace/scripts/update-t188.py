import json
from datetime import datetime

with open('C:/dev/FsuelsBot/workspace/memory/tasks.json', 'r', encoding='utf-8') as f:
    tasks = json.load(f)

# Update T188
tasks['tasks']['T188']['status'] = 'done'
tasks['tasks']['T188']['completed_at'] = datetime.now().isoformat()
tasks['tasks']['T188']['epistemic'] = {
    'claims': ['Posted local SEO capabilities post from @GhostBrokerAI'],
    'verified': ['https://x.com/GhostBrokerAI/status/2017848303539388924'],
    'verification_status': 'evidence_provided',
    'confidence': 1.0
}

# Move T188 to done
if 'T188' in tasks['lanes']['bot_queue']:
    tasks['lanes']['bot_queue'].remove('T188')
if 'T188' not in tasks['lanes']['done_today']:
    tasks['lanes']['done_today'].insert(0, 'T188')

# Create T208 for verification
tasks['tasks']['T208'] = {
    'title': 'VERIFY: Local SEO X Post',
    'status': 'pending',
    'created': datetime.now().isoformat(),
    'owner': 'francisco',
    'context': {
        'summary': """WHY: Promoting Ghost Broker's local SEO packages ($99-499/mo). Links to local-seo.html landing page.

POST LINK: https://x.com/GhostBrokerAI/status/2017848303539388924

TEXT POSTED:
"Most businesses pay $500-2000/mo for local SEO.

AI agents do it for a fraction.

📍 Google Business Profile optimization
⭐ Review response system
🗺️ Citation building
📊 Monthly analytics

Packages from $99/mo

ghostbrokerai.xyz/local-seo.html"

GOAL: Drive traffic to local SEO landing page. Convert local businesses."""
    },
    'approach': 'Click link to verify post looks good. Mark complete.'
}

if 'T208' not in tasks['lanes']['human']:
    tasks['lanes']['human'].insert(0, 'T208')

tasks['version'] += 1
tasks['updated_at'] = datetime.now().isoformat()

with open('C:/dev/FsuelsBot/workspace/memory/tasks.json', 'w', encoding='utf-8') as f:
    json.dump(tasks, f, indent=4)

print('T188 done, T208 created for verification')
