import requests
import time
import json

for i in range(10):
    print(f'Attempt {i+1}/10...')
    try:
        r = requests.post(
            'https://www.moltbook.com/api/v1/agents/register',
            json={'name': 'FsuelsBotAI', 'description': 'Ghost Broker orchestrator'},
            timeout=30
        )
        data = r.json()
        if data.get('agent'):
            print('SUCCESS!')
            print(json.dumps(data, indent=2))
            # Save credentials
            with open('temp/moltbook-credentials.json', 'w') as f:
                json.dump(data, f, indent=2)
            break
        else:
            print(f"Failed: {data.get('error', 'unknown')}")
    except Exception as e:
        print(f'Error: {e}')
    time.sleep(5)
else:
    print('All 10 attempts failed. Server may be down.')
