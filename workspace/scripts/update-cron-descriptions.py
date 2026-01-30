import json
from datetime import datetime, timezone

with open('memory/tasks.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

# Full informative context for each task
updates = {
    'CRON-20260130-consolidation': {
        'title': 'Save what I learned today to memory',
        'notes': """WHY THIS EXISTS:
Without this, I forget everything between sessions. My context gets truncated and I lose track of what happened.

WHAT IT DOES:
1. Reads today's conversation notes
2. Extracts important facts, decisions, and lessons
3. Saves them to my long-term memory files
4. Rebuilds the "recall pack" - my cheat sheet for tomorrow

WHAT YOU GET:
- I remember our conversations and decisions
- I don't repeat mistakes
- I pick up where we left off without you re-explaining

RUNS: Every day at 3 AM while you sleep""",
        'context': {
            'summary': 'Memory consolidation prevents context loss. Without it, I forget everything and you have to repeat yourself.',
            'decisions': ['Auto-scheduled nightly to run while Francisco sleeps'],
            'constraints': ['Must complete before morning session starts']
        }
    },
    'CRON-20260130-research-brief': {
        'title': 'Check AI news and report to Francisco',
        'notes': """WHY THIS EXISTS:
AI moves fast. New tools, updates, and tricks appear daily. You want to stay ahead without spending hours reading Twitter.

WHAT IT DOES:
1. Scans your X/Twitter feed for AI news
2. Searches web for Clawdbot, Claude, agent updates
3. Checks ClawdHub for new skills we could use
4. Identifies top 3 actionable improvements
5. Sends you a summary on Telegram

WHAT YOU GET:
- Stay current on AI without the work
- Discover tools that save time or make money
- Get improvements I can implement for you

RUNS: Every day at 9 AM""",
        'context': {
            'summary': 'Daily AI intelligence briefing so Francisco stays ahead of the curve without doing the research himself.',
            'decisions': ['Focuses on actionable improvements, not just news'],
            'constraints': ['Must be concise - you are busy']
        }
    },
    'CRON-20260130-research-brief-jan29': {
        'title': 'Catch up: AI news from yesterday',
        'notes': """WHY THIS EXISTS:
This task failed to run yesterday. We might have missed important AI news or updates.

WHAT IT DOES:
Retroactive check of Jan 29 AI news to see if we missed anything important.

WHAT YOU GET:
Peace of mind that nothing slipped through the cracks.

STATUS: Catch-up task (should have run Jan 29 at 9 AM)""",
        'context': {
            'summary': 'Catch-up for missed Jan 29 research brief.',
            'decisions': [],
            'constraints': []
        }
    },
    'CRON-20260130-curiosity-jan29': {
        'title': 'Catch up: Look for business opportunities',
        'notes': """WHY THIS EXISTS:
You cannot monitor everything. This job scans for things you might miss - competitor price changes, platform updates, seasonal opportunities.

WHAT IT DOES:
1. Checks for anomalies in sales/traffic
2. Looks for competitor moves
3. Scans for platform changes (Shopify, etc.)
4. Generates max 3 proposals for things we could do
5. Adds them to the backlog for review

WHAT YOU GET:
- Opportunities you would have missed
- Early warning on threats
- Ideas backed by data, not guessing

RUNS: Every day at 9 PM
STATUS: Catch-up task (should have run Jan 29)""",
        'context': {
            'summary': 'Proactive opportunity scanning so Francisco does not miss money-making chances.',
            'decisions': ['Limited to 3 proposals to avoid overwhelm'],
            'constraints': ['Cannot suggest new product categories or brand pivots without approval']
        }
    },
    'CRON-20260130-learn-jan29': {
        'title': 'Catch up: What did I learn yesterday?',
        'notes': """WHY THIS EXISTS:
Every day I make mistakes or discover better ways. If I do not capture those lessons, I repeat the same mistakes forever.

WHAT IT DOES:
1. Reviews what happened during the day
2. Identifies what went wrong or could be better
3. Extracts specific lessons (Context / Failure / Fix / Prevention)
4. Updates my knowledge files so I do not repeat errors
5. Commits changes to git

WHAT YOU GET:
- I get smarter every day
- Same mistakes do not happen twice
- Continuous improvement without you teaching me

RUNS: Every day at 10:30 PM
STATUS: Catch-up task (should have run Jan 29)""",
        'context': {
            'summary': 'Self-improvement loop. I extract lessons from failures so I compound knowledge instead of repeating mistakes.',
            'decisions': ['Max 5 lessons per night to stay focused'],
            'constraints': ['Must commit to git for traceability']
        }
    },
    'CRON-20260130-ship-jan29': {
        'title': 'Catch up: Do overnight work from yesterday',
        'notes': """WHY THIS EXISTS:
You sleep 8 hours. That is 8 hours I could be working. This job picks the most valuable task and executes it while you rest.

WHAT IT DOES:
1. Reads the backlog of pending tasks
2. Scores each by value/effort/risk
3. Picks the highest scoring task that is safe to do
4. Executes it (writes content, fixes SEO, etc.)
5. Sends you a morning report of what got done

WHAT YOU GET:
- Wake up to completed work
- Backlog shrinks while you sleep
- Multiplies your productivity by working 24/7

RUNS: Every day at 11 PM
STATUS: Catch-up task (should have run Jan 29)""",
        'context': {
            'summary': 'Overnight autonomous work. I ship real tasks while Francisco sleeps, so he wakes up to progress.',
            'decisions': ['Only picks tasks that are safe and reversible'],
            'constraints': ['Will not do anything that needs approval', 'Max 45 min timeout']
        }
    }
}

count = 0
for tid, update in updates.items():
    if tid in data.get('tasks', {}):
        data['tasks'][tid]['title'] = update['title']
        data['tasks'][tid]['notes'] = update['notes']
        data['tasks'][tid]['context'] = update['context']
        count += 1
        print(f"Updated: {update['title']}")

data['updated_at'] = datetime.now(timezone.utc).isoformat()

with open('memory/tasks.json', 'w', encoding='utf-8') as f:
    json.dump(data, f, indent=2, ensure_ascii=False)

print(f"\nDone - updated {count} tasks with full explanations")
