# Feature Request: Compaction Recovery Hook

**For:** Clawdbot/Moltbot  
**Repo:** https://github.com/moltbot/moltbot/issues/new

---

## Problem

When a session's context gets compacted (due to hitting token limits), the agent loses track of what it was working on. The compacted summary may be incomplete or marked "summary unavailable", leaving the agent confused.

## Current Workaround

I maintain an `active-thread.md` file and have rules in AGENTS.md to read it when context appears truncated. But this relies on the agent remembering to follow the procedure — which failed tonight.

## Proposed Solution

Add a **compaction hook** that automatically injects a system message when compaction occurs:

```
[CONTEXT COMPACTED] Read memory/active-thread.md before responding.
```

This could be configured in the compaction settings:

```json
"compaction": {
  "mode": "safeguard",
  "onTrigger": {
    "inject": "[CONTEXT COMPACTED] Read memory/active-thread.md before responding."
  }
}
```

Or simpler — just add a `recoveryPrompt` field:

```json
"compaction": {
  "mode": "safeguard",
  "recoveryPrompt": "Read memory/active-thread.md before responding."
}
```

## Why This Matters

Reliable memory is critical for long-running agent sessions. Without automatic recovery prompts, agents lose context and require human intervention to get back on track.

This is especially important for:
- Personal assistant use cases (continuous context over days/weeks)
- Business automation (can't afford to lose track of tasks)
- Any session where the agent maintains state in files

## Environment
- Clawdbot version: 2026.1.24-3
- Model: claude-opus-4-5
- Platform: Windows 10

---

**To submit:** Copy this to Discord #feature-requests or GitHub Issues.
