# Moltbot Memory Workflow (Deep Dive)

This document summarizes how memory works in this project, based on reading the implementation and related docs.

## 1) Memory is layered, not a single feature

The project uses three memory layers:

1. Session state memory (small metadata store)
   - `sessions.json` stores `sessionKey -> SessionEntry`.
   - This tracks the current `sessionId`, timestamps, model/toggle overrides, usage counters, compaction count, and memory-flush markers.

2. Conversation transcript memory (turn history)
   - Each `sessionId` points to a JSONL transcript file.
   - Transcript is the source for rebuilding conversation context for model runs.

3. Durable file memory (cross-session recall)
   - Workspace markdown memory files (`MEMORY.md`, `memory/*.md`) plus optional indexed session transcript source.
   - Accessed through `memory_search` and `memory_get` tools.
   - Indexed in per-agent SQLite for semantic retrieval.

Important implication:
- "Context continuation" after normal turns/compaction mostly comes from transcript replay.
- "Cross-session recall" (especially after `/new` or reset) should come from durable memory files + memory tools.

## 2) Session key and session id lifecycle

### Session key resolution
- Inbound messages are mapped to a canonical `sessionKey`.
- Direct chats usually collapse to the agent main session key.
- Group/channel chats get isolated keys.
- Thread/topic sessions can derive thread-specific handling.

### Session id reuse vs rotation
At turn start (`initSessionState`):
- Reads existing `SessionEntry` from store.
- Applies reset triggers (`/new`, `/reset`, plus configured triggers) if sender is authorized.
- Evaluates freshness policy:
  - daily boundary (default 4:00 local time),
  - idle expiration,
  - optional per-type/per-channel overrides.
- If fresh and not reset: reuse same `sessionId`.
- Otherwise: create new `sessionId` and transcript path.

### On reset/new
- New `sessionId` is assigned.
- Compaction-cycle fields are reset:
  - `compactionCount = 0`
  - `memoryFlushCompactionCount = undefined`
  - `memoryFlushAt = undefined`
- Existing per-session overrides are preserved where intended (thinking/model/etc).

## 3) Persistence model and locking

### Session store (`sessions.json`)
- Read/write helpers use a lock file (`.lock`) for safe concurrent updates.
- Write path supports platform differences (Windows direct write, Unix temp+rename).
- Store cache with TTL exists, but updates re-read inside lock to avoid clobbering.

### Transcript files (`<sessionId>.jsonl`)
- Managed via `SessionManager` from `@mariozechner/pi-coding-agent`.
- Before each run, a session write lock is acquired for transcript safety.
- Lock has stale lock recovery and process-signal cleanup.

## 4) What happens on each model run

For embedded Pi runs, the flow is:

1. Open/prepare session transcript
   - `SessionManager.open(sessionFile)`
   - `prepareSessionManagerForRun(...)` fixes first-turn persistence quirks.

2. Guard transcript appends
   - `guardSessionManager(...)` installs tool-result guard.
   - Ensures tool call/result pairing safety and can synthesize missing results when policy allows.

3. Sanitize loaded history before prompt
   - `sanitizeSessionHistory(...)` applies provider/policy-specific cleanup:
     - image/content sanitization,
     - tool-call/result repair,
     - Google turn-order fixups,
     - reasoning block downgrades when model/provider changed.

4. Optional history limiting
   - DM-specific history turn limiting can trim old user/assistant turns before prompt send.

5. Run prompt, stream events, flush, persist
   - Streaming subscribers track assistant/tool/compaction lifecycle.
   - Pending synthetic tool results are flushed before release/dispose.

## 5) Compaction behavior

### Manual compaction
- `/compact [instructions]` runs explicit compaction for current session.
- If successful, compaction count is incremented in session store.

### Auto compaction
- In run loop, on context overflow error:
  - attempts one auto-compaction (`compactEmbeddedPiSessionDirect`),
  - if compacted, retries prompt in same session.
- If compaction cannot recover, returns context overflow failure payload.

### Compaction persistence and continuation
- `session.compact(...)` writes compaction summary into transcript.
- Continued conversation in same session uses summary + retained recent turns.
- Streaming subscriber tracks compaction start/end/retry and waits for retry completion before finalizing run output.

### Compaction mode and safeguard
- Default config behavior applies compaction mode `"safeguard"` when unset.
- Safeguard extension can:
  - adapt chunking to context share,
  - prune old history chunks to fit budgets,
  - summarize in stages,
  - include tool-failure and file-op details in summary fallback.

## 6) Pre-compaction memory flush

A special "silent" run can occur before compaction threshold is hit:

- Enabled by default under `agents.defaults.compaction.memoryFlush`.
- Trigger condition uses:
  - session `totalTokens`,
  - context window,
  - `reserveTokensFloor`,
  - soft threshold.
- It runs one flush per compaction cycle (`memoryFlushCompactionCount` guard).
- It is skipped for:
  - heartbeat turns,
  - CLI providers,
  - read-only/no-workspace sandbox.
- Prompt/system prompt include `NO_REPLY` guidance to keep it user-invisible.
- On completion, updates:
  - `memoryFlushAt`,
  - `memoryFlushCompactionCount`,
  - and possibly compaction count if flush run itself compacted.

## 7) Durable memory tools and retrieval

### Tool availability
- Memory tools come from memory plugin slot (`memory-core` by default).
- Plugin can be disabled (`plugins.slots.memory = "none"`).
- When enabled, tools are:
  - `memory_search`
  - `memory_get`

### Prompt-level recall contract
- System prompt injects explicit instruction:
  - before answering prior-work/preferences/todos questions,
  - run `memory_search`, then `memory_get` only for needed lines.

### Indexing and sources
- `MemoryIndexManager` manages embeddings + index sync.
- Default source is `memory` (markdown files).
- Optional `sessions` source can index transcripts when enabled (`experimental.sessionMemory` + source selection).
- Session transcript updates emit events; manager marks dirty and delta-syncs session files.
- Per-agent index defaults to:
  - `~/.clawdbot/memory/<agentId>.sqlite`

### Session transcript indexing details
- Session JSONL is parsed; only user/assistant text content is extracted.
- Stored as synthetic path like `sessions/<filename>.jsonl` in index metadata.
- Supports dirty-file and threshold-based delta sync to reduce unnecessary full indexing.

## 8) Recovery after context resets, compaction, and corruption

### Normal compaction recovery
- Same `sessionId` is kept.
- Compacted transcript persists summary.
- Prompt is retried and conversation continues.

### Hard recovery paths
If unrecoverable errors occur, higher-level runner can reset session:
- compaction failure overflow,
- role ordering conflicts,
- known transcript corruption patterns.

Reset path does:
- generate new `sessionId` and new transcript path,
- persist new entry in store,
- update active in-memory state,
- optionally delete previous transcript for cleanup in some conflict cases.

Result:
- Conversation restarts cleanly in new session.
- Historical transcript may still exist on disk unless cleanup path deletes it.
- Durable memory files remain the intended mechanism for carrying facts across such resets.

## 9) Other memory-adjacent behavior

- Session usage/model/token metadata is persisted each run (`persistSessionUsageUpdate`).
- `compactionCount` is tracked and surfaced in status outputs.
- Internal hook system can use `previousSessionEntry` on `/new` events (for custom memory-save workflows).
- Transcript event bus (`emitSessionTranscriptUpdate`) decouples transcript writes from memory index sync logic.

## 10) Practical mental model

If you ask "how does the agent remember?":

- During a session: from transcript replay.
- When transcript gets too large: compaction persists summary and keeps recent turns.
- After a reset/new session: transcript continuity is intentionally broken; durable memory tools/files should be used for recall.
- If transcript becomes invalid: sanitize/repair first, otherwise rotate to new session.

---

## Main files studied (complete paths)

- `C:\dev\FsuelsBot\src\auto-reply\reply\session.ts`
- `C:\dev\FsuelsBot\src\auto-reply\reply\get-reply.ts`
- `C:\dev\FsuelsBot\src\auto-reply\reply\get-reply-run.ts`
- `C:\dev\FsuelsBot\src\auto-reply\reply\agent-runner.ts`
- `C:\dev\FsuelsBot\src\auto-reply\reply\agent-runner-execution.ts`
- `C:\dev\FsuelsBot\src\auto-reply\reply\agent-runner-memory.ts`
- `C:\dev\FsuelsBot\src\auto-reply\reply\memory-flush.ts`
- `C:\dev\FsuelsBot\src\auto-reply\reply\session-updates.ts`
- `C:\dev\FsuelsBot\src\auto-reply\reply\session-usage.ts`
- `C:\dev\FsuelsBot\src\auto-reply\reply\commands-compact.ts`
- `C:\dev\FsuelsBot\src\auto-reply\reply\commands-core.ts`
- `C:\dev\FsuelsBot\src\config\sessions.ts`
- `C:\dev\FsuelsBot\src\config\sessions\types.ts`
- `C:\dev\FsuelsBot\src\config\sessions\store.ts`
- `C:\dev\FsuelsBot\src\config\sessions\paths.ts`
- `C:\dev\FsuelsBot\src\config\sessions\reset.ts`
- `C:\dev\FsuelsBot\src\config\sessions\session-key.ts`
- `C:\dev\FsuelsBot\src\config\sessions\group.ts`
- `C:\dev\FsuelsBot\src\config\sessions\main-session.ts`
- `C:\dev\FsuelsBot\src\config\sessions\transcript.ts`
- `C:\dev\FsuelsBot\src\routing\session-key.ts`
- `C:\dev\FsuelsBot\src\agents\pi-embedded-runner\run.ts`
- `C:\dev\FsuelsBot\src\agents\pi-embedded-runner\run\attempt.ts`
- `C:\dev\FsuelsBot\src\agents\pi-embedded-runner\compact.ts`
- `C:\dev\FsuelsBot\src\agents\pi-embedded-runner\google.ts`
- `C:\dev\FsuelsBot\src\agents\pi-embedded-runner\history.ts`
- `C:\dev\FsuelsBot\src\agents\pi-embedded-runner\session-manager-init.ts`
- `C:\dev\FsuelsBot\src\agents\pi-embedded-runner\extensions.ts`
- `C:\dev\FsuelsBot\src\agents\pi-embedded-subscribe.ts`
- `C:\dev\FsuelsBot\src\agents\pi-embedded-subscribe.handlers.ts`
- `C:\dev\FsuelsBot\src\agents\pi-embedded-subscribe.handlers.lifecycle.ts`
- `C:\dev\FsuelsBot\src\agents\session-tool-result-guard.ts`
- `C:\dev\FsuelsBot\src\agents\session-tool-result-guard-wrapper.ts`
- `C:\dev\FsuelsBot\src\agents\session-transcript-repair.ts`
- `C:\dev\FsuelsBot\src\agents\session-write-lock.ts`
- `C:\dev\FsuelsBot\src\agents\transcript-policy.ts`
- `C:\dev\FsuelsBot\src\agents\compaction.ts`
- `C:\dev\FsuelsBot\src\agents\pi-settings.ts`
- `C:\dev\FsuelsBot\src\agents\system-prompt.ts`
- `C:\dev\FsuelsBot\src\agents\tools\memory-tool.ts`
- `C:\dev\FsuelsBot\src\agents\memory-search.ts`
- `C:\dev\FsuelsBot\src\memory\manager.ts`
- `C:\dev\FsuelsBot\src\memory\search-manager.ts`
- `C:\dev\FsuelsBot\src\memory\index.ts`
- `C:\dev\FsuelsBot\src\sessions\transcript-events.ts`
- `C:\dev\FsuelsBot\src\plugins\slots.ts`
- `C:\dev\FsuelsBot\src\plugins\config-state.ts`
- `C:\dev\FsuelsBot\extensions\memory-core\index.ts`
- `C:\dev\FsuelsBot\src\hooks\bundled\session-memory\handler.ts`
- `C:\dev\FsuelsBot\src\config\defaults.ts`
- `C:\dev\FsuelsBot\src\config\io.ts`
- `C:\dev\FsuelsBot\docs\concepts\memory.md`
- `C:\dev\FsuelsBot\docs\concepts\session.md`
- `C:\dev\FsuelsBot\docs\concepts\compaction.md`
- `C:\dev\FsuelsBot\docs\reference\session-management-compaction.md`
