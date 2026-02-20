# Task Memory

- taskId: we-need-to-improve-the-task-card

## Goal
Improve the task card UI in Mission Control dashboard

## Current State
Status: in_progress Task cards are sparse: just slug, description, "UNASSIGNED" badge, pause/cancel buttons Francisco sent an image showing what he wants but it didn't carry over across sessions He's frustrated about repeated context loss — wants me to just DO it ## Key Facts Mission Control URL: http://localhost:8765/ (NOT :18789 gateway) Source: `workspace/mission-control/index.html` (~5500-line single HTML file, Python server) Task cards already have extensive features in code (badges, steps, modals, verification) but rendering is minimal Kanban has 3 columns: BOT-WORKING NOW, BOT-QUEUE, FRANCISCO-YOUR TASKS Plus DONE (collapsed), KNOW ME GAME (collapsed), SCHEDULED/CRON (0 jobs) ## Observed Issues (from screenshot analysis) Cards are too sparse — no progress, timestamps, or enrichment "UNASSIGNED" badge uses red — looks like an error state Pause/cancel buttons are tiny and close together No step progress shown despite plan steps existing No time tracking visible No assignee display ## Proposed Improvements Priority/status colored indicators Step progress bar ("Step 2/3") Timestamps ("created 15m ago") Better assignee chip (not red "UNASSIGNED") Larger action buttons with labels Card metadata footer row

## Decisions
- _None._
- (none yet)
- Be proactive — just implement improvements without waiting for more specifics

## Open Questions
- _None._
- Q1: Is this from a different app/project, or should we BUILD this as new Mission Control feature?
- Q2: What specifically needs improvement — layout, styling, functionality, or all?
- What does Francisco mean by "task card"? The screenshot from msg 6763 doesn't exist in the codebase.
- Francisco said localhost:18789 is NOT Mission Control — what IS the correct UI/location?
- What specific improvements does he want?
- ## Plan
- [x] Search codebase for task card component
- [ ] Get Francisco's clarification on which UI and what changes
- [ ] Implement improvements
- [ ] Test and verify
- ## Current Step: 2 — Get clarification
- What specific improvements does Francisco want? (visual, mobile, new features, etc.)
- Francisco clarified "You are Fsuelsbot!" — the dashboard is for his FsuelsBot project, not OpenClaw itself
- ## Checklist
- [x] Find Mission Control (localhost:8765)
- [x] Locate task card source code
- [ ] Get specific improvement requests from Francisco

## Next Actions
- Read index.html task card rendering code
- Implement improvements based on observed issues
- Test by reloading Mission Control
- Screenshot and confirm with Francisco

## Key Entities
- _None._

## Pinned
- _None._

## Notes
- # Task: Improve Task Cards in Mission Control
- # Task: Improve the Task Card UI
- **ID:** we-need-to-improve-the-task-card
- **Created:** 2026-02-20
- **Status:** in_progress — awaiting Francisco's clarification
- > ID: we-need-to-improve-the-task-card
- > Status: in_progress
- > Created: 2026-02-20
- > Updated: 2026-02-20 01:38 EST
- # Task: Improve Task Card UI
- **Status:** in_progress — waiting on Francisco's specific improvement requests
- **Updated:** 2026-02-20 01:43 EST
- ## Key Facts
- Mission Control URL: http://localhost:8765/
- Source: `~/clawd/workspace/mission-control/index.html` (157KB, ~5500 lines, single HTML file)
- Server: `activity-server.py` (Python), started via `start-mission-control.sh`
- Auth key: DASHBOARD_KEY in start script
- ## Architecture
- Task cards: `.task-item` CSS class (~line 374)
- Task detail modal: `#taskModal` (~line 1579)
- Render function: `renderTask()` (~line 2532)
- Existing features: priority/project/specialty badges, step progress, verification status, claim system, reorder controls, transfer buttons, delete
- Modal sections: status, project selector, context, epistemic status, steps, approach, notes, learnings, receipts, audit log, plan link
- Hardcoded projects: FsuelsBot, 123LegalDoc, DressLikeMommy
- ## RESOLVED Questions
- ✅ "Mission Control" = localhost:8765 (NOT localhost:18789 which is the OpenClaw gateway UI)
- ✅ Task card code found in workspace/mission-control/index.html
- # Task: Improve Task Card UI in Mission Control
