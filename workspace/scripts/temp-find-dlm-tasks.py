import json

t = json.load(open('memory/tasks.json'))

keywords = ['valentine', 'dlm', 'shopify', 'seo', 'dress', 'listing', 'product']

for task_id, task in t['tasks'].items():
    title = task.get('title', '').lower()
    status = task.get('status', '')
    if any(k in title for k in keywords) and status in ['pending', 'in_progress', 'waiting']:
        print(f"{task_id}: {task.get('title')} [{status}]")
