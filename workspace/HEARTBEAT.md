# HEARTBEAT.md

## Infrastructure (check every heartbeat)
- **Mission Control server** — Is port 8765 listening? If not, restart: `Start-ScheduledTask -TaskName "MissionControlServer"`
- If you had to restart it, send Francisco the mobile URL via Telegram:
  **📱 Dashboard:** http://192.168.4.25:8765?key=a6132abf77194fd10a77317a094771f1
- **URLs:** localhost:8765 (PC) | 192.168.4.25:8765 (mobile on WiFi)

## Memory Integrity (check every heartbeat)
Run validator: `powershell -ExecutionPolicy Bypass -File "C:\dev\FsuelsBot\workspace\tests\validators\memory-integrity.ps1"`
- If any ERRORS: alert Francisco immediately
- If warnings only: note them, continue
- Log results in memory/heartbeat-state.json under "memoryCheck"

## Core Loops (check every heartbeat)

### Pressure Loop Check
- Any sub-agent tasks completed since last heartbeat? → Run pressure check
- Any errors logged? → Check for patterns in .learnings/
- 3+ similar tasks this week? → Propose template/automation
- Review recent outputs for improvement opportunities

### Research Loop Check
- Any pending research briefs to deliver?
- Seasonal events approaching (<30 days)? → Research opportunities
- Competitor changes detected? → Alert + response proposal
- If no research done today → light opportunity scan

### Dispatch Check
- Backlog items scoring 12+? → Execute immediately
- Backlog items scoring 8-11? → Queue as priority for today
- Uncommitted git changes? → Commit and push

## Periodic Checks (rotate through, 2-4x daily)

### Self-Improvement (weekly)
- Check for Clawdbot updates: `clawdbot --version` vs `npm view clawdbot version`
- Check for skill updates: `clawdhub update --all`
- Review `.learnings/` files for patterns and promote insights
- Review recent `memory/` files and update MEMORY.md with key takeaways
- Check ClawdHub for new relevant skills
- Review earn/kill metrics for all agents

### Quick Checks (daily)
- Weather in Naples FL (if human might be going out)
- Any pending DLM Shopify tasks from memory files

### AI Research (daily via cron at 9 AM, supplement during heartbeats)
- Scan X feed (@Cogitolux) for AI agent news, tricks, discoveries
- Watch for Clawdbot/Moltbot updates, new skills, community insights
- Check Claude/Anthropic announcements
- Note expert tips and improvement opportunities
- See RESEARCH-BRIEF.md for full format

### Git Backup (auto via cron at 11 PM)
- Workspace auto-commits and pushes to github.com/fsuels/FsuelsBot
- If heartbeat, check if there are uncommitted changes and push

## Dashboard Discipline
- ALWAYS update current-task.json when starting/finishing tasks
- ALWAYS update team.json status when dispatching/completing work
- Include: description, benefit, progress, steps, strategy for every task
