# TOOLS.md - Local Notes

Skills define _how_ tools work. This file is for _your_ specifics — the stuff that's unique to your setup.

## What Goes Here

Things like:

- Camera names and locations
- SSH hosts and aliases
- Preferred voices for TTS
- Speaker/room names
- Device nicknames
- Anything environment-specific

## Examples

```markdown
### Cameras

- living-room → Main area, 180° wide angle
- front-door → Entrance, motion-triggered

### SSH

- home-server → 192.168.1.100, user: admin

### TTS

- Preferred voice: "Nova" (warm, slightly British)
- Default speaker: Kitchen HomePod
```

## Why Separate?

Skills are shared. Your setup is yours. Keeping them apart means you can update skills without losing your notes, and share skills without leaking your infrastructure.

---

## Local Tools & Access

### Peekaboo (macOS UI Automation)

- Installed via Homebrew: `peekaboo`
- Permissions: Screen Recording ✅, Accessibility ✅ (granted 2026-02-19)
- Skill: /Users/fsuels/clawd/skills/peekaboo/SKILL.md
- Use for: screenshots, UI element targeting, clicking, typing, drag-and-drop, app/window management

### Hammerspoon (macOS Automation)

- Installed at /Applications/Hammerspoon.app
- `hs` CLI may not be in PATH — use IPC or `open hammerspoon://` as fallback
- Use for: window management, key simulation, scripting macOS automation

### Computer Access

- Francisco has granted FULL access to his computer (confirmed 2026-02-19)
- No need to ask permission for local actions — just execute
- Browser (Chrome), file system, apps, shell — all available

Add whatever helps you do your job. This is your cheat sheet.
