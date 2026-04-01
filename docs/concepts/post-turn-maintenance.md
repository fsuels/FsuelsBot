---
summary: "How post-turn maintenance runs after user-facing turns without blocking the main reply path."
read_when:
  - You are changing durable memory extraction
  - You need to understand maintenance scheduling, coalescing, or shutdown behavior
---

# Post-Turn Maintenance

OpenClaw now has a small post-turn maintenance lane for background upkeep that should not slow down the main reply path.

## Lifecycle

- Only the main user-facing embedded runner schedules maintenance.
- Maintenance is skipped for subagents and for internal/background runs such as cron, slug generation, and memory flushes.
- A run is eligible only after the assistant finishes an idle turn:
  - no abort
  - no structured error
  - no pending tool loop
  - no `tool_calls` stop reason

## Queueing Model

- Maintenance is queued per `sessionKey`.
- Only one maintenance pass runs per session at a time.
- If more work arrives while a pass is running, OpenClaw keeps only the latest pending context.
- After the active pass finishes, exactly one trailing pass runs with that latest context.
- `drainPendingMaintenance(timeoutMs, queueKey?)` lets compaction or shutdown wait for:
  - one specific session queue, or
  - all queues globally

## Durable Memory Extractor

- The current maintenance job is a durable-memory extractor.
- It tracks a cursor in the session store so each successful run only inspects conversation content that has not already been processed.
- Eligible turns can be throttled; until the threshold is reached, the cursor stays put so the next run sees the full accumulated slice.
- If the main agent already wrote to `MEMORY.md` or `memory/**` in the inspected range, the extractor skips itself and advances the cursor anyway. This avoids duplicate or conflicting memory edits.

## Isolation and Permissions

- The extractor works on a temporary copy of the durable-memory workspace (`MEMORY.md` plus `memory/**`).
- Its tool surface is intentionally narrow:
  - `read`
  - `write`
  - `edit`
  - `find`
  - `grep`
- Those tools are restricted to durable-memory paths only.
- After the worker finishes, only changed durable-memory files are synced back into the real workspace.
- The worker uses an in-memory agent session, so it does not append its own transcript to the user session file.

## Compaction and Shutdown

- Compaction waits briefly for in-flight maintenance on the same session before proceeding.
- Gateway shutdown waits briefly for all maintenance queues to drain.
- If a drain timeout expires, OpenClaw logs and continues rather than hanging indefinitely.
