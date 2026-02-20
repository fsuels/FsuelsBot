# HEARTBEAT.md

## Quick Checks (every heartbeat)

1. Verify MEMORY.md exists at /Users/fsuels/clawd/MEMORY.md — if missing, recreate from memory/global/\*.md
2. Check `memory/tasks.json` for in-progress tasks with running sub-agents → report if completed/failed
3. If a sub-agent has been idle >5 minutes, investigate

## Do NOT

- Run Mission Control bootstrap on heartbeats
- Send proactive messages unless something is actually broken
- Report "all clear" status — just reply HEARTBEAT_OK if nothing needs attention
