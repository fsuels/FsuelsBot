import json
with open('memory/tasks.json', 'r', encoding='utf-8') as f:
    data = json.load(f)
disc = data['tasks']['T180'].get('discussion', [])
for d in disc:
    print(f"{d.get('author', '?')}: {d.get('message', '?')}")
    print()
