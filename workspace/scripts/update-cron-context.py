import json
from datetime import datetime, timezone

with open('memory/tasks.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

# Clear, benefit-focused context for each task
updates = {
    'CRON-20260130-consolidation': {
        'context': {
            'why_exists': 'I forget everything between sessions. Without this, you have to repeat yourself every day.',
            'benefit_to_you': 'I remember what we talked about. I learn from mistakes. You never have to explain things twice.',
            'summary': 'Saves important information to long-term memory so I can remember tomorrow what happened today.',
            'schedule': 'Every day at 3 AM'
        }
    },
    'CRON-20260130-research-brief': {
        'context': {
            'why_exists': 'AI changes daily. New tools appear that could save you time or make you money. You are too busy to read Twitter all day.',
            'benefit_to_you': 'Stay ahead of AI without doing the work. Get actionable improvements delivered to you. Save hours of research time.',
            'summary': 'Scans AI news and sends you a brief with the top 3 things you should know about.',
            'schedule': 'Every day at 9 AM'
        }
    },
    'CRON-20260130-research-brief-jan29': {
        'context': {
            'why_exists': 'This was supposed to run yesterday but failed. We might have missed important news.',
            'benefit_to_you': 'Make sure nothing slipped through the cracks on Jan 29.',
            'summary': 'Catch-up task to check what AI news we missed yesterday.',
            'schedule': 'One-time catch-up'
        }
    },
    'CRON-20260130-curiosity-jan29': {
        'context': {
            'why_exists': 'You cannot watch everything - competitor prices, platform changes, seasonal trends. I can.',
            'benefit_to_you': 'Catch opportunities you would miss. Get early warning on threats. Make money from things you did not even know about.',
            'summary': 'Scans for business anomalies, competitor moves, and opportunities you might have missed.',
            'schedule': 'Every day at 9 PM'
        }
    },
    'CRON-20260130-learn-jan29': {
        'context': {
            'why_exists': 'I make mistakes. If I do not write down what I learned, I repeat them forever.',
            'benefit_to_you': 'I get smarter every day. Same mistake never happens twice. You get a better assistant without training me.',
            'summary': 'Reviews the day, extracts lessons from failures, updates my knowledge so I improve.',
            'schedule': 'Every day at 10:30 PM'
        }
    },
    'CRON-20260130-ship-jan29': {
        'context': {
            'why_exists': 'You sleep 8 hours. I do not sleep. Those hours should produce work, not be wasted.',
            'benefit_to_you': 'Wake up to completed work. Your backlog shrinks while you rest. 24/7 productivity without hiring anyone.',
            'summary': 'Picks the most valuable safe task from the backlog and actually does it while you sleep.',
            'schedule': 'Every day at 11 PM'
        }
    }
}

count = 0
for tid, update in updates.items():
    if tid in data.get('tasks', {}):
        data['tasks'][tid]['context'] = update['context']
        count += 1
        print(f"Updated: {tid}")

data['updated_at'] = datetime.now(timezone.utc).isoformat()

with open('memory/tasks.json', 'w', encoding='utf-8') as f:
    json.dump(data, f, indent=2, ensure_ascii=False)

print(f"\nDone - {count} tasks now have clear why/benefit context")
