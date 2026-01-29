---
version: "1.0"
created: "2026-01-28"
updated: "2026-01-28"
verified: "2026-01-28"
confidence: "medium"
---

# Context Recovery Procedure

*Last updated: 2026-01-28*

## When to Use This

- Context got truncated/compacted
- "Summary unavailable" appears
- You feel confused about what you were doing
- Something seems off about the conversation flow

## Recovery Steps

### Step 1: Stop
Do NOT respond to the user yet. Take a breath.

### Step 2: Read Active Thread
```
Read memory/active-thread.md
```
This is your primary recovery point. It contains:
- Current task description
- Recent completed work
- Standing rules
- Context that survives truncation

### Step 3: Read State
```
Read memory/state.json
```
This is authoritative. Contains:
- Current task ID and status
- Progress (completed/remaining)
- Waiting-on items
- Session context

### Step 4: Read Today's Log
```
Read memory/2026-01-28.md  (use actual date)
```
Raw notes from today's work.

### Step 5: Check AGENTS.md
The CURRENT STATE section at the top is rendered from state.json.
If state.json is corrupted, this is your backup.

### Step 6: Reconstruct from Events (if needed)
```
Read memory/events.jsonl
```
Every state change is logged here. You can reconstruct the full history.

### Step 7: Resume
Now you have context. Respond to the user.

## Prevention

- Update active-thread.md after EVERY significant action
- Keep state.json current
- Append to events.jsonl on state changes
- Trust files over internal memory

## Example Recovery

User message: "Keep going with what we discussed"
Internal state: Truncated, no context

1. Read active-thread.md → See "Building memory reliability system"
2. Read state.json → See progress checklist
3. Read today's log → See specific actions taken
4. Now I know exactly what to continue

## Remember

**Files are truth. Internal memory is ephemeral.**

If there's a conflict between what you "remember" and what files say, trust the files.
