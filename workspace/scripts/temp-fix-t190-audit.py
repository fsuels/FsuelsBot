import json
from datetime import datetime

with open('memory/tasks.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

# Update T190 with full audit trails for each target
data['tasks']['T190']['audit_trail'] = {
    'captured_at': datetime.now().isoformat(),
    'targets': [
        {
            'source_url': 'https://x.com/karpathy/status/2019440193300672513',
            'author': '@karpathy',
            'author_bio': 'Andrej Karpathy - Former Tesla AI Director, OpenAI founding member, Stanford PhD. 1.6M followers.',
            'original_post': {
                'full_text': '[POST ABOUT @moltbook FRAMEWORK - need to capture full text]',
                'note': 'Referenced moltbook AI agent framework'
            },
            'engagement_snapshot': {
                'views': '12.8M'
            },
            'why_relevant': 'Karpathy mentioning moltbook = massive validation for agent frameworks. His audience is exactly who needs to know about Arena 2.0.'
        },
        {
            'source_url': 'https://x.com/DrJimFan/status/2018399273608016158',
            'author': '@DrJimFan',
            'author_bio': 'Jim Fan - NVIDIA Senior Research Scientist, AI researcher. 352K followers.',
            'original_post': {
                'full_text': '[POST ABOUT MULTI-AGENT SIMULATIONS - need to capture full text]',
                'note': 'Discussed multi-agent civilization simulations'
            },
            'engagement_snapshot': {
                'views': '94K'
            },
            'why_relevant': 'Multi-agent simulations = exactly what Arena 2.0 enables. His research audience overlaps with our target users.'
        },
        {
            'source_url': 'https://x.com/profbuehlermit/status/2017681323524051021',
            'author': '@ProfBuehlerMIT',
            'author_bio': 'Markus J. Buehler - McAfee Professor of Engineering at MIT. Legitimate academic researcher. 23K followers.',
            'original_post': {
                'full_text': """Everyone is obsessed with @openclaw and @moltbook and the idea of autonomous agents running your life or building societies. But what happens when you scale that up? What if, instead of agents checking your calendar and posting on Reddit, you had hundreds of agents...""",
                'note': 'AI swarm that designs novel proteins through negotiation, debate, and local optimization. Key insight: decentralized logic, no training required, pure emergence.'
            },
            'engagement_snapshot': {
                'views': '16,700',
                'likes': '97',
                'reposts': '22',
                'bookmarks': '39'
            },
            'key_comments': '@metatransformr: multi-agent coordination is the frontier. @DianeMKane1: skeptic calling out hype. Buehler linked Sparks paper on adversarial design.',
            'why_relevant': 'MIT professor validating multi-agent swarms = academic credibility for Arena 2.0 thesis.'
        }
    ]
}

# Mark that full audit trails still need completion for Karpathy and Jim Fan
data['tasks']['T190']['steps'] = [
    {'step': 'Research AI researchers on X', 'status': 'done', 'completed_at': '2026-01-31T19:27:58'},
    {'step': 'Capture Karpathy post full text', 'status': 'pending'},
    {'step': 'Capture Jim Fan post full text', 'status': 'pending'},
    {'step': 'Buehler post captured', 'status': 'done', 'completed_at': '2026-01-31T19:27:58'},
    {'step': 'Draft replies for all three', 'status': 'pending'},
    {'step': 'Francisco approves replies', 'status': 'pending'},
    {'step': 'Post from @GhostBrokerAI', 'status': 'pending'}
]
data['tasks']['T190']['current_step'] = 1

data['version'] = data['version'] + 1
data['updated_at'] = datetime.now().isoformat()

with open('memory/tasks.json', 'w', encoding='utf-8') as f:
    json.dump(data, f, indent=2, ensure_ascii=False)

print('T190 updated with audit trail structure - Karpathy and Jim Fan posts need full capture')
