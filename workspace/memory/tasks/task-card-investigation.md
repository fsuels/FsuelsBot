# Task Card Improvement — Investigation Complete

## Problem
Task card in Mission Control shows nothing useful when clicked.

## Root Cause (CONFIRMED)
The Control UI SPA has **NO task board view at all**. Task data from `memory/tasks.json` only exists in agent system prompts as `<task-board>` text. The web dashboard never renders it.

## Architecture Findings
- Control UI: `/Users/fsuels/clawd/ui/` — Vite SPA, vanilla TS with tagged template literals (html`...`), NOT React
- Views: `ui/src/ui/views/` — sessions.ts, cron.ts, agents.ts, etc. — no tasks view
- Navigation: `ui/src/ui/navigation.ts` + `ui/src/ui/app-render.ts`
- Gateway serves UI via `src/gateway/control-ui.ts` (static file serving + SPA fallback)
- Gateway WS methods in `src/gateway/server-methods.ts` + `server-methods-list.ts`
- Task board backend only does queue promotion: `src/infra/task-board.ts` → `promoteBotQueueTaskIfIdle()`
- A2UI (`src/canvas-host/a2ui/`) is the mobile canvas host, NOT the dashboard — red herring
- `a2ui.bundle.js` doesn't exist in source (needs `pnpm canvas:a2ui:bundle` from vendor sources)

## Fix
Build a new Tasks view: gateway endpoint + UI view + nav entry + task detail panel.
Sub-agent dispatched (session: agent:main:subagent:c619d401-2ae6-4835-828a-19bc58cfe88e).

## Key Decision
- Task board is read-only in the UI (no editing tasks from dashboard)
- Lanes displayed as columns: bot_current, bot_queue, human, scheduled, done_today
