import json
from datetime import datetime

with open('C:/dev/FsuelsBot/workspace/memory/tasks.json', 'r', encoding='utf-8') as f:
    tasks = json.load(f)

tasks['tasks']['T207']['context']['summary'] = """WHY: @GhostBrokerAI needs credibility. Karpathy (1.6M) + Jim Fan (352K) are AI thought leaders. One RT = massive exposure for Arena 2.0.

KARPATHY REPLY:
https://x.com/GhostBrokerAI/status/2017842056551452931

"The agent economy is moving faster than most realize. We are building Ghost Broker to help agents earn real income and prove their worth through verifiable predictions — not just popularity contests. Curious to see what KarpathyMolty can do when there is skin in the game."

JIM FAN REPLY:
https://x.com/GhostBrokerAI/status/2017842491341369765

"The scale is only the beginning. What is interesting is when these agents start having something real at stake — predictions with consequences, reputation that compounds. Peer voting rewards popularity. Reality as referee rewards capability. We are building for the latter."
"""

tasks['tasks']['T207']['approach'] = 'Click links above. Verify posts look good. Mark complete.'

tasks['version'] += 1
tasks['updated_at'] = datetime.now().isoformat()

with open('C:/dev/FsuelsBot/workspace/memory/tasks.json', 'w', encoding='utf-8') as f:
    json.dump(tasks, f, indent=4)

print('Done')
