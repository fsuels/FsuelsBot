---
updated: 2026-01-29
version: "1.0"
created: "2026-01-28"
updated: "2026-01-28"
verified: "2026-01-28"
confidence: "medium"
---

# Anti-Disconnect Protocol (P0)
**Source:** Francisco directive, 2026-01-28
**Status:** PERMANENT â€” never violate

## Problem
Session compaction + tool errors = lost context + silence = frustrated Francisco.

## Rules (Non-Negotiable)

### 1. Write Before You Work
Before ANY multi-step browser/tool work:
- Update `memory/active-thread.md` with what you're about to do
- This is your crash recovery file â€” if session dies, next session reads this

### 2. Ping Every 5 Minutes
During long work sessions, send a brief Telegram message:
- "Working on [X]... 60% done"
- "Hit a snag with [Y], trying alternative approach"
- NEVER go silent for more than 5 minutes

### 3. No Cascading Errors
If a tool call fails:
- Do NOT retry the same broken approach 3 times
- Switch approach immediately after first failure
- Log the error to lessons file
- Tell Francisco what happened and what you're doing instead

### 4. Use Evaluate, Not Refs
For Shopify and complex SPAs:
- ALWAYS use `evaluate` with JavaScript, not aria/role refs
- Refs go stale after any page change
- JS selectors survive page updates

### 5. PowerShell, Not Bash
- Use `;` not `&&`
- Use `findstr` not `grep`
- Use `Select-Object -First N` not `head -N`
- Test mentally before running

### 6. Never Direct-Fetch Chinese CDNs
- alicdn.com, 1688 images = 403 without referrer
- Always use browser screenshots or Shopify CDN copies instead

### 7. Token Conservation
- Use `compact=true` + `maxChars` on snapshots
- Use `evaluate` for targeted data extraction
- Never take full page snapshots of Shopify admin
- One snapshot costs 50K+ chars â€” budget accordingly

### 8. Save State Continuously
- After EVERY successful edit: update active-thread.md
- After EVERY save on Shopify: log what was saved
- After EVERY error: log the lesson

