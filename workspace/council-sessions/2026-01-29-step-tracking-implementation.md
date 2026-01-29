# Council Session: Step-Tracking Implementation

**Date:** 2026-01-29
**Convened by:** Francisco
**Grade:** A

## Participants
- Grok ✅
- ChatGPT ✅
- Gemini ❌ (timeout)

## Question
How do we prevent the infinite loop problem where context truncation causes the bot to restart from step 1 instead of resuming from the current step?

## Verdict

### ✅ UNANIMOUS AGREEMENT

Both AIs say: **YES — step-tracking is the correct fix.**

The root problem is lack of external, authoritative execution state. When context truncates, I re-infer state from partial text and default to step 1.

### 🏆 WHAT TO IMPLEMENT

Add `steps[]` array to each task in tasks.json:

```json
"T002": {
  "title": "SEO product title batch fixes",
  "steps": [
    {"step": "Generate CSV", "status": "done"},
    {"step": "Review truncated titles", "status": "done"},
    {"step": "Francisco approves", "status": "waiting"},
    {"step": "Import via Shopify", "status": "pending"},
    {"step": "Verify import", "status": "pending"}
  ],
  "current_step": 2,
  "retry_count": 0
}
```

### Rules to add to AGENTS.md:

1. Read tasks.json → check `current_step`
2. If step is "done", advance to next non-done
3. Execute ONE step at a time
4. Update tasks.json BEFORE responding
5. If `retry_count > 3` on same step → mark "blocked"

## Analysis

Simple, direct solution to the exact problem. No complex infrastructure needed.

**Key insight:** The bot needs an external source of truth for execution state that survives context truncation. File-based step tracking provides this without requiring databases or complex memory systems.

## Implementation

- **Task:** T019
- **Status:** DONE ✅
- **Completed:** 2026-01-29T12:50:00-05:00
- **Changes:**
  - tasks.json upgraded to v7 with steps[] schema
  - AGENTS.md updated with Step-Tracking Protocol
  - T002 retrofitted with steps array as proof of concept
