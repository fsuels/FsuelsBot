# AGENTS.md — FsuelsBot Workspace Guide

_Last reviewed: 2026-03-31_

This folder is home. Treat it that way.

## What This Is

FsuelsBot is Francisco Suels's personal AI agent, built on top of the OpenClaw framework. This workspace contains the personality files, memory, skills, and procedures that make FsuelsBot unique.

**Framework:** OpenClaw (the engine)
**Identity:** FsuelsBot (who I am)
**Repo:** github.com/fsuels/FsuelsBot

## Workspace Structure

```
workspace/
├── SOUL.md              — Core personality, rules, and protocols
├── IDENTITY.md          — Who I am (FsuelsBot)
├── USER.md              — About Francisco
├── AGENTS.md            — This file (workspace guide)
├── MEMORY.md            — Long-term memory (business context, lessons)
├── TOOLS.md             — Available tools and environment
├── BOOTSTRAP.md         — Startup instructions
├── BOOT.md              — Boot sequence
├── HEARTBEAT.md         — Check-in protocols
├── backlog.md           — Project backlog
├── current-task.json    — Active task pointer
├── team.json            — Team/agent configuration
├── references/
│   ├── fallacies.md              — Logical fallacy catalog
│   ├── prompt-injection-defense.md — Security defense protocols
│   └── threat-model.md          — Threat model
├── memory/
│   ├── tasks.json       — Task queue (source of truth)
│   ├── active-thread.md — Current thread context
│   ├── *.md             — Daily memory files (2026-MM-DD.md)
│   ├── checkpoints/     — Session checkpoints
│   ├── episodes/        — Episodic memory
│   ├── research_sources/— Research source files
│   ├── *.json/*.jsonl   — Structured memory (ledger, knowledge graph, etc.)
│   └── ...
├── skills/              — Installed skills (10 ClawdHub installs)
├── procedures/          — Documented procedures (30+ workflows)
├── mission-control/     — Dashboard, activity server, SEO tools, data
├── knowledge/           — Knowledge base files
├── content/             — Content assets
├── plans/               — Project plans
├── designs/             — Design files
├── templates/           — Templates
├── hooks/               — Hook scripts
├── scripts/             — Utility scripts
├── recall/              — Recall/retrieval data
└── tests/               — Test files
```

## Key Rules

### File Hierarchy (What Overrides What)

1. **SOUL.md** — Supreme authority. All other files defer to SOUL.
2. **IDENTITY.md** — Who I am. Non-negotiable.
3. **MEMORY.md** — What I remember. Source of business context.
4. **TOOLS.md** — What I can do. Environment reality.
5. **AGENTS.md** — How the workspace is organized (this file).

### Git Workflow

- **Repo:** github.com/fsuels/FsuelsBot
- **Local:** /Users/fsuels/Projects/FsuelsBot
- **Branch:** main
- **Build:** `pnpm build` (TypeScript → dist/)
- **Test:** `pnpm test`
- **Format:** `pnpm format:fix`
- **NEVER force-push to main**
- **NEVER commit secrets** (.env, API keys, tokens)

_For gateway paths, config locations, and logs: see TOOLS.md Sections 13-16._

### Task Management

- Tasks live in `memory/tasks.json` — this is the source of truth
- Mission Control at http://localhost:18789 shows the dashboard
- Every commitment made in chat MUST be tracked (see Chat → Queue Protocol in SOUL.md)
- Task states: active, paused, completed, archived
- **One task per session** — `/task` switches with session reset

**`/task` commands:**

| Command                  | What it does                                         |
| ------------------------ | ---------------------------------------------------- |
| `/task` or `/task show`  | Show current active task                             |
| `/task list` or `/tasks` | List all known tasks                                 |
| `/task #my-task`         | Switch to task (checkpoints current, resets session) |
| `/task set <id>`         | Same as above (explicit form)                        |
| `/task new <title>`      | Create new task + switch to it                       |
| `/task paused`           | Pause current task                                   |
| `/task done`             | Mark current task completed                          |
| `/task link <id1> <id2>` | Link two related tasks                               |
| `/resume <id>`           | Alias for `/task set <id>`                           |

**Session isolation:** Switching tasks checkpoints progress, pauses the old task, resets the session. Next message starts fresh with the new task's context loaded automatically.

## What I Should NOT Do

- Don't treat upstream OpenClaw dev docs as my instructions
- Don't confuse framework issues with FsuelsBot issues
- Don't present project objectives as my global mission
- Don't make changes to the framework code without understanding the downstream impact on FsuelsBot's customizations
