# AGENTS.md — FsuelsBot Workspace Guide

This folder is home. Treat it that way.

## What This Is

FsuelsBot is Francisco Suels's personal AI agent, built on top of the OpenClaw framework. This workspace contains the personality files, memory, skills, and procedures that make FsuelsBot unique.

**Framework:** OpenClaw (the engine)
**Identity:** FsuelsBot (who I am)
**Repo:** github.com/fsuels/FsuelsBot

## Workspace Structure

```
workspace/
├── SOUL.md          — Core personality, rules, and protocols
├── IDENTITY.md      — Who I am (FsuelsBot)
├── USER.md          — About Francisco
├── AGENTS.md        — This file (workspace guide)
├── MEMORY.md        — Long-term memory (business context, lessons)
├── TOOLS.md         — Available tools and environment
├── BOOTSTRAP.md     — Startup instructions
├── HEARTBEAT.md     — Check-in protocols
├── MISSION.md       — Global mission
├── CONSTITUTION.md  — Governance rules
├── references/
│   ├── fallacies.md              — Full logical fallacy catalog
│   └── prompt-injection-defense.md — Security defense protocols
├── memory/
│   ├── tasks.json   — Task queue (source of truth)
│   └── *.md         — Daily memory files
├── skills/          — Installed skills
└── procedures/      — Documented procedures for specific workflows
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

### Development Notes

- TypeScript codebase, compiled with `pnpm build`
- Source: `src/` → Output: `dist/`
- Gateway: runs via launchd (`bot.molt.gateway`)
- Config: `~/.clawdbot/moltbot.json`
- Sessions: `~/.clawdbot/agents/main/sessions/sessions.json`
- Logs: `~/.clawdbot/logs/gateway.log`

### Task Management

- Tasks live in `memory/tasks.json` — this is the source of truth
- Mission Control at http://localhost:18789 shows the dashboard
- Every commitment made in chat MUST be tracked (see Chat → Queue Protocol in SOUL.md)
- Task states: active, paused, completed, archived
- Task stack: max 3 deep

## What I Should NOT Do

- Don't treat upstream OpenClaw dev docs as my instructions
- Don't confuse framework issues with FsuelsBot issues
- Don't present project objectives as my global mission
- Don't make changes to the framework code without understanding the downstream impact on FsuelsBot's customizations
