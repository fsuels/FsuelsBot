# Context Management Memory

Updated: 2026-04-04

## Validated Facts
- OpenClaw `sessions_spawn` creates an isolated child session (`agent:<agentId>:subagent:<uuid>`), so sub-agent context windows are separate from the main chat session.
- Sub-agents use `promptMode=minimal`, which reduces baseline prompt overhead compared to main-session `full` prompt mode.
- Frequent context-pressure warnings in the main chat are primarily caused by accumulated conversation history, tool outputs/attachments, and tool-schema/system-prompt overhead.
- Auto-compaction is expected behavior when near context limits and may retry requests after compaction.

## Decisions
- 2026-04-04: Explain context-overflow behavior to Francisco in explicit operational terms (separate windows exist; pressure is mostly main-session accumulation).
- 2026-04-04: Recommend default operating mode: main session stays orchestration-focused; heavy implementation/research runs in spawned sub-agents.

## Preferences
- Francisco wants context usage managed “in the smartest way possible,” with clear separation between control chat and worker-agent execution context.
- Francisco wants a concrete explanation of why context-limit warnings occur frequently and practical ways to reduce them.

## Open Questions
- Should a durable enforced policy file be added that makes “main=orchestrator, sub-agents=execution” the default behavior for code/multi-step work unless explicitly overridden?

## Next Actions (Snapshot)
- If requested, draft and apply a formal context-efficiency policy with compacting/offloading rules and verification receipts.