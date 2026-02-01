import json
from datetime import datetime

with open('memory/tasks.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

# Add discussion to T191 audit trail
data['tasks']['T191']['audit_trail']['discussion'] = [
    {
        'event_id': 1,
        'ts': '2026-01-31T19:38:00-05:00',
        'author': 'human',
        'message': 'Shared X link: https://x.com/thejayden/status/2017665841639080157 (Polymarket math post)'
    },
    {
        'event_id': 2,
        'ts': '2026-01-31T19:38:30-05:00',
        'author': 'bot',
        'message': 'Analyzed thejayden post. Found 210K views on Polymarket trading math. Not directly relevant to Ghost Broker. BUT spotted Alex Finn Clawdbot post in "Discover more" section - 9.5M views on autonomous agent calling owner.'
    },
    {
        'event_id': 3,
        'ts': '2026-01-31T19:38:45-05:00',
        'author': 'human',
        'message': 'Do this other! (referring to Alex Finn post)'
    },
    {
        'event_id': 4,
        'ts': '2026-01-31T19:41:00-05:00',
        'author': 'human',
        'message': 'Each link is a separate task!'
    },
    {
        'event_id': 5,
        'ts': '2026-01-31T19:41:30-05:00',
        'author': 'bot',
        'message': 'Created T191 as separate task for Alex Finn post. T190 remains for researcher campaign (Karpathy, Jim Fan, Buehler).'
    },
    {
        'event_id': 6,
        'ts': '2026-01-31T19:41:45-05:00',
        'author': 'human',
        'message': 'Why the card has nothing for the audit trail???'
    },
    {
        'event_id': 7,
        'ts': '2026-01-31T19:42:00-05:00',
        'author': 'bot',
        'message': 'Added full audit_trail with original_post.full_text, engagement_snapshot, key_replies[], analysis_logic.'
    },
    {
        'event_id': 8,
        'ts': '2026-01-31T19:43:00-05:00',
        'author': 'human',
        'message': 'Why did I tell you! Each task must always have audit trail!'
    },
    {
        'event_id': 9,
        'ts': '2026-01-31T19:43:30-05:00',
        'author': 'bot',
        'message': 'Logged Learning #50: EVERY task card MUST have audit_trail. Updated procedures/x-link-analysis.md with mandatory section.'
    },
    {
        'event_id': 10,
        'ts': '2026-01-31T19:43:45-05:00',
        'author': 'human',
        'message': 'Yes, however respect X rules (approving posts)'
    },
    {
        'event_id': 11,
        'ts': '2026-01-31T19:44:00-05:00',
        'author': 'bot',
        'message': 'Draft reply too long (377 chars, limit 280). Shortened to 218 chars. Posted reply from @GhostBrokerAI.'
    },
    {
        'event_id': 12,
        'ts': '2026-01-31T19:45:00-05:00',
        'author': 'bot',
        'message': 'Reply posted: https://x.com/GhostBrokerAI/status/2017761424773181764'
    }
]

# Also add the final posted reply text to audit trail
data['tasks']['T191']['audit_trail']['posted_reply'] = {
    'url': 'https://x.com/GhostBrokerAI/status/2017761424773181764',
    'text': "Henry didn't ask permission — he just got himself a phone number.\n\nThis is the future: agents hiring other agents. Need voice? Need research? Hire an agent.\n\nWe're building the marketplace for this: ghostbrokerai.xyz",
    'posted_at': '2026-01-31T19:44:30-05:00',
    'character_count': 218
}

data['version'] = data['version'] + 1

with open('memory/tasks.json', 'w', encoding='utf-8') as f:
    json.dump(data, f, indent=2, ensure_ascii=False)

print('T191 discussion added to audit trail')
