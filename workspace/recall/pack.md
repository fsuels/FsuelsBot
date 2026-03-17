# Recall Pack - 2026-03-17

_Auto-generated context for session start (lightweight)_

## Current State

- **Status:** Cron / maintenance (no runnable bot_current)
- **Mission Control:** running (per heartbeat-checks.ps1)

## P0 Constraints / Standing Rules

- VALIDATE `memory/tasks.json` BEFORE ANY WRITE (`scripts/validate-tasks-integrity.ps1`)
- Receipts rule: never claim tools/actions without observable output/log evidence
- One task per session; switch via `/task`

## Open Loops (Index)

- Open commitments: 0 (`memory/index/open-loops.json`)
- **WAITING_HUMAN tasks:** 6 (`memory/tasks.json` → lanes.human)
  - Epistemic review (needs Grok/X browser)
  - GhostBroker X engagement tasks (need attached X tab)
  - BuckyDrop check (needs logged-in session)
  - Pomelli dresses refresh (resume)

## Recent Ships (evidence)

- `workspace/knowledge/ops/nightly-learn-2026-03-16.md` (commit 23deb3166)
- Backlog status correction for GMC best-practices research (commit 918cc16b0)
- Daily backup (commit 6ca312b25)

## Quick Stats

- Ledger lines: 16 (`memory/ledger.jsonl`)
- Bot lanes: bot_current=0, bot_queue=0
