# Trust Files, Not Memory

**Date:** 2026-01-28
**Category:** correction
**Source:** Francisco corrected me when I lost context after compaction

## The Learning
When context gets compacted and I see "summary unavailable," I should IMMEDIATELY read recovery files (active-thread.md, state.json) instead of trying to guess or ask what we were doing.

## Context
- Context compaction is inevitable in long sessions
- Summaries can fail or be incomplete
- Files persist; memory doesn't

## Action
1. If context looks truncated → read state.json + active-thread.md FIRST
2. Never respond to user before recovering context
3. Trust files over internal "memory"

## Applied To
- [x] AGENTS.md — Added "Context Truncation Recovery" section
- [x] CONSTITUTION.md — Memory rules
- [x] state.json — Created as authoritative source
