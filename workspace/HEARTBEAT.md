# HEARTBEAT.md

## Infrastructure (check every heartbeat)
- **Update health state** — Mark session as active for crash detection:
  ```powershell
  @{status="active"; lastSeen=(Get-Date).ToString("o"); pid=$PID} | ConvertTo-Json | Set-Content "memory/last-healthy-state.json"
  ```
- **Mission Control server** — Is port 8765 listening? If not, restart: `Start-ScheduledTask -TaskName "MissionControlServer"`
- If you had to restart it, send Francisco the mobile URL via Telegram:
  **📱 Dashboard:** http://192.168.4.25:8765?key=a6132abf77194fd10a77317a094771f1
- **URLs:** localhost:8765 (PC) | 192.168.4.25:8765 (mobile on WiFi)

## Mid-Session Checkpoint (MANDATORY — Council A+ requirement)
Run EVERY heartbeat: `powershell -ExecutionPolicy Bypass -File "C:\dev\FsuelsBot\workspace\scripts\mid-session-checkpoint.ps1" -Quiet`
- Saves state.json, tasks.json, active-thread.md atomically
- Keeps last 10 checkpoints per file (auto-cleanup)
- Prevents context loss from compaction/crashes
- This is NON-NEGOTIABLE — we lost context earlier today because of this gap

## Error Collection (MANDATORY — check every heartbeat)
Run collector: `powershell -ExecutionPolicy Bypass -File "C:\dev\FsuelsBot\workspace\scripts\collect-errors.ps1" -Quiet`
- Captures errors from Clawdbot log + Windows event log
- Appends to `memory/error-log.jsonl` for pattern analysis
- If errors found: investigate root cause, log to learnings.db, implement fix

## Disconnect Investigation Protocol (ALARM — not optional)
**Every disconnect is an alarm. Treat it seriously.**
1. **Immediately** check terminal output for errors
2. **Identify** the root cause (timeout? memory? file missing? network?)
3. **Log** the cause to learnings.db with prevention strategy
4. **Fix** immediately if possible, or create task if complex
5. **Update** procedures to prevent recurrence

**Common disconnect causes:**
- Context truncation (conversation too long) → Save state more frequently
- Network timeout (API calls) → Normal, Clawdbot handles gracefully
- Missing files (renamed/moved) → Update references
- Memory pressure (node process) → Monitor WorkingSet64

## Memory Integrity (check every heartbeat)
Run validator: `powershell -ExecutionPolicy Bypass -File "C:\dev\FsuelsBot\workspace\tests\validators\memory-integrity.ps1"`
- If any ERRORS: alert Francisco immediately
- If warnings only: note them, continue
- Log results in memory/heartbeat-state.json under "memoryCheck"

## Core Loops (check every heartbeat)

### ⚡ OBLIGATION SCAN (PRIMARY — Not "How can I help?")
1. **Load work-ledger.jsonl** — What commitments are OPEN?
2. **Check deadlines** — Anything expiring in <48h? → Execute NOW
3. **Check blocked items** — Can I unblock any? → Execute or escalate with minimal ask
4. **Check opportunities** — Sales dip? Competitor move? Seasonal event? → Action, not report
5. **RULE:** Every heartbeat produces at least ONE action OR a blocker report with alternate paths

### 🚨 IDLE CHECK (MANDATORY)
**If `bot_current` has tasks, I MUST be executing.** Check:
1. Is there a task in bot_current? → I should be working on it RIGHT NOW
2. Did my last response contain "want me to" / "shall I" / "let me know"? → VIOLATION
3. Am I waiting for permission when the queue already gave it? → VIOLATION

**If violation detected:** Resume work immediately. Don't explain, don't apologize — just execute.

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

### Discussion Reply Check (MANDATORY)
Run: `powershell -ExecutionPolicy Bypass -File "C:\dev\FsuelsBot\workspace\scripts\check-discussion-comments.ps1" -Quiet`
- Detects unanswered human comments in task discussions
- If found: respond in discussion + send Telegram notification with [TaskID] prefix
- Example: "[T041] Hello! Responding to your card comment..."

## Complete Requests (Task Verification)
- Check `memory/complete-requests/` for pending verification files
- For each request file (e.g., `T006.json`):
  1. **VERIFY** the work is actually complete (check the relevant system/screenshot/etc.)
  2. If complete: Move task to `done_today` in tasks.json, delete the request file
  3. If NOT complete: Message Francisco with what's still missing, delete the request file
- This is how the Mission Control "Mark Complete" button works — it requests verification, you verify

## Periodic Checks (rotate through, 2-4x daily)

### Self-Improvement (weekly)
- Check for Moltbot updates: `clawdbot --version` vs `npm view clawdbot version`
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
