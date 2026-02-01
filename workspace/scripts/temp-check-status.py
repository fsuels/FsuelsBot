import json
with open('memory/tasks.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

for tid in ['T190', 'T180', 'T174']:
    t = data['tasks'].get(tid, {})
    print(f"{tid}: {t.get('title', '?')[:50]}")
    print(f"   Status: {t.get('status', '?')}")
    if 'steps' in t:
        curr = t.get('current_step', 0)
        for i, s in enumerate(t['steps']):
            marker = '>>>' if i == curr else '   '
            step_name = s.get('step', '?')[:45]
            step_status = s.get('status', '?')
            waiting = s.get('waiting_for', '')
            if waiting:
                print(f"   {marker} [{step_status}] {step_name} - WAITING: {waiting}")
            else:
                print(f"   {marker} [{step_status}] {step_name}")
    print()
