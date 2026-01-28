# HEARTBEAT.md

## Periodic Checks (rotate through, 2-4x daily)

### Self-Improvement (weekly)
- Check for Clawdbot updates: `clawdbot --version` vs `npm view clawdbot version`
- Check for skill updates: `clawdhub update --all`
- Review `.learnings/` files for patterns and promote insights
- Review recent `memory/` files and update MEMORY.md with key takeaways
- Check ClawdHub for new relevant skills

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
