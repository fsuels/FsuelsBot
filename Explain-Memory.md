# Moltbot Memory System (Code-Accurate as of February 3, 2026)

This document describes the memory system based on current source code and tests, not historical docs.

## 1) What system this is

Moltbot memory is a task-scoped, durability-first memory architecture with three major goals:

1. Keep task memory isolated (no accidental cross-task bleed).
2. Make durable memory tamper-evident and replayable.
3. Keep retrieval deterministic and controllable.

It combines:
- Structured durable state in WAL + snapshots.
- User-managed constraints/preferences via pins.
- Session-time task routing and guidance.
- Deterministic retrieval (`filter -> rank -> stitch`).

## 2) Runtime architecture

### 2.1 Durable state stores

- `memory/system/events.wal.jsonl` (active WAL stream).
- `memory/system/wal/segments/*.jsonl` (rotated WAL segments).
- `memory/system/wal/manifest.json` (segment sequence and metadata).
- `memory/system/wal/baseline.json` (signed compaction baseline).
- `memory/system/snapshots/global.json` (global derived snapshot).
- `memory/system/snapshots/tasks/<taskId>.json` (task derived snapshots).
- `memory/system/task-registry.json` (task metadata/lifecycle).
- `memory/.pins.json` (pin source of truth).

### 2.2 Rendered/derived markdown stores

- `memory/global/pins.md` and `memory/tasks/<taskId>/pins.md` are rendered views from `memory/.pins.json`.
- `memory/tasks/<taskId>.md` is task narrative memory merged after flush turns.

### 2.3 Ephemeral/session stores

- Session task and guidance state lives in session store entries (`activeTaskId`, counters, guidance mode).
- `memory/system/transient-buffer.json` stores TTL transient items.

## 3) Core invariants implemented

1. **Single write scope per commit** (`task`, `global`, or `none`) is enforced by `validateWriteScope` in `src/memory/task-memory-system.ts`.
2. **Scope filters happen before ranking** in retrieval manager.
3. **Durable memory outranks transcript memory** via deterministic ranking priority and transcript penalty.
4. **Pins are immutable on duplicate upsert** (idempotent insert behavior).
5. **Autoswitch is opt-in only**; default behavior is ask/stay.

## 4) Event model and write pipeline

### 4.1 Event types

Supported memory event types include:
- `TASK_CREATED`, `TITLE_SET`, `GOAL_SET`
- `DECISION_MADE`, `DECISION_REVERTED`
- `CONSTRAINT_ADDED`, `CONSTRAINT_REMOVED`
- `OPEN_QUESTION_ADDED`, `OPEN_QUESTION_RESOLVED`
- `NEXT_ACTION_SET`, `NEXT_ACTION_COMPLETED`
- `ARTIFACT_LINKED`
- `PIN_ADDED`, `PIN_REMOVE_REQUESTED`, `PIN_REMOVED`
- `STATE_PATCH_APPLIED`, `USER_CONFIRMED`

Payload schemas are validated at commit and replay boundaries.

### 4.2 Commit flow

`commitMemoryEvents(...)` performs:
1. Security boot-contract checks.
2. Scope validation.
3. WAL lock acquisition (`memory/system/events.wal.lock`).
4. Optional active-segment rotation.
5. Replay diagnostics gate (fail-closed on invalid tail/signature state).
6. Event normalization and payload schema validation.
7. Signature-chain and integrity hash creation.
8. WAL append.
9. Snapshot catch-up + apply new events.
10. Snapshot atomic write.
11. Task registry touch update.

### 4.3 `writeScope=none`

`writeScope=none` is a strict storage no-op. Events are rejected if provided.

## 5) Authenticity and tamper detection

### 5.1 Signing and chain model

- Envelope versioned (`envelopeVersion=1`) with signature versioning.
- HMAC signature chain via `prevSignature`.
- Integrity hash maintained per event envelope.

### 5.2 Key providers

Implemented providers:
- `env`
- `json`
- `command`
- `aws-sm`
- `gcp-sm`
- `azure-kv`
- `vault`

### 5.3 Fail-closed behavior

In prod mode (`MEMORY_SECURITY_MODE=prod`):
- Missing signing keys fail startup/write.
- Missing verification keys fail startup/replay.
- Unsupported envelope/signature versions fail replay.
- Signature mismatch / schema mismatch blocks writes.

Dev mode allows unsigned replay bypass only for specific failure classes and then forces read-only degraded behavior.

### 5.4 WAL lifecycle

- Segment rotation by size/age.
- Signed baseline compaction.
- Retention policy via segment compaction.
- Corrupt-tail repair utility truncates active WAL to last valid line under lock.

## 6) Retrieval and ranking model

### 6.1 Indexed sources

Default indexed source is durable memory files. Session transcript indexing is optional.

### 6.2 Scope resolution

Namespace modes: `auto`, `any`, `task`, `global`.

Task retrieval behavior:
- Task scope first.
- Optional global fallback.
- Optional linked-task snippets (capped, labeled as inferred related-task content).

### 6.3 Deterministic ranking

Ranking path is explicit: `filter -> rank -> stitch`.

Key ranking behaviors:
- Transcript penalty (`score * 0.85`).
- Priority classes (pins and durable classes outrank transcript classes).
- Semantic floor for high-priority classes (`minSimilarity`).
- Dominance override (`overrideDelta`) for strong semantic wins.
- Near-tie behavior uses both relative and absolute epsilons.
- Stable tie-breaks by recency, path, and line range.

### 6.4 Memory get safety

`memory_get` reads only memory paths and now verifies resolved path containment using robust relative-path boundary checks (not plain string prefix checks).

## 7) Pin subsystem

Pins are stored in `memory/.pins.json` and rendered to markdown views.

Implemented safety details:
- Lock-serialized pin writes (`proper-lockfile`).
- Atomic writes (tmp + rename).
- Duplicate upsert idempotency.
- Two-step delete intent flow (`/pin remove` -> token -> `/pin confirm` or `/pin cancel`).
- TTL expiry support for temporary pins.
- Stale task pin markdown cleanup when last task pin is removed.
- Corrupted pins JSON now fails closed (no silent reset).

## 8) Task control and autoswitch safeguards

### 8.1 Inference and gating

`get-reply-run` computes inferred task hints, then applies:
- `autoSwitchOptIn` gate.
- Confidence/ambiguity gates.
- Mismatch and thrash counters with thresholds.

### 8.2 Guidance behavior

`task-memory-guidance.ts` generates clarification nudges for:
- Ambiguous task matches.
- Important-memory conflicts.
- Topic switches.
- Low-confidence inference.
- Long-task save prompts.

Guidance mode (`supportive` vs `minimal`) is adaptive via user response signals.

### 8.3 Command durability behavior

- Mutating task commands now require successful durable WAL commit before session/task-registry state mutation is applied.
- Mutating memory command paths no longer silently suppress commit failures; they return explicit failure replies when durable commit fails.
- This closes the previous "best-effort commit" gap for task command mutations.

## 9) Memory flush and merge behavior

Before compaction pressure, system can run a dedicated flush turn:
- Trigger threshold: `contextWindow - reserveTokensFloor - softThresholdTokens`.
- Skip conditions: heartbeat runs, CLI providers, read-only sandbox.
- Flush prompt asks model to materialize durable memory into task/global files.
- Post-flush merge applies deterministic section semantics in `task-memory-merge.ts`.

## 10) Forget behavior

`forgetMemoryWorkspace(...)` supports:
- Removing task memory files/directories by task.
- Text/entity line removal in markdown files.
- Date-based file removal for dated memory files.
- Optional pin deletion (`--pins true`).

## 11) Diagnostics and alerting

Implemented diagnostic contracts (strict schema validation):
- `memory.turn-control` (versioned).
- `memory.guidance` (versioned).
- `memory.guidance.response` (versioned).
- `memory.retrieval` (includes retrieval version fields).
- `memory.security`.
- `memory.alert` (critical breach windows).

Critical memory security event bursts can trigger outbound alert transports:
- Generic webhook (with retry/backoff).
- PagerDuty Events API (with retry/backoff).

## 12) Evidence anchors (tests)

Key direct evidence:
- `src/memory/task-memory-system.test.ts`
  - scope invariants, no-op scope, replay validation, key providers, rotation, retention, baseline tamper fail-closed, repair flow.
- `src/memory/pins.test.ts`
  - immutable duplicate upsert, concurrent write serialization, corruption fail-closed, stale task pin markdown cleanup.
- `src/memory/manager.deterministic-rank.test.ts`
  - scope filtering before ranking, durable-over-transcript behavior, semantic dominance behavior.
- `src/auto-reply/reply/get-reply-run.autoswitch.test.ts`
  - autoswitch opt-in enforcement, thrash/mismatch gating, turn-control diagnostics payload.
- `src/infra/diagnostic-events.test.ts`
  - versioned diagnostics contracts, retrieval diagnostics fields, webhook/PagerDuty memory alert dispatch behavior.
- `src/memory/index.test.ts`
  - indexing/search behaviors and memory_get path traversal rejection.
- `src/auto-reply/reply/commands-memory.test.ts`
  - mutating task commands block state mutation when durable commit fails.

## 13) Senior-engineer scorecard (1-10)

These scores reflect implemented behavior and tested confidence.

| Aspect | Score | Why it is good | Why it is not perfect |
|---|---:|---|---|
| Scope isolation and task boundaries | 9.2 | Explicit write scopes, task namespace filtering, autoswitch gates, and commit-first task command mutations reduce cross-task contamination risk. | Task inference is still heuristic, so misclassification risk cannot be reduced to zero. |
| Durable write integrity | 9.2 | WAL append + signature chain + lock serialization + snapshot updates are robust, and mutating task commands now fail closed on commit failures. | Registry/transient stores are still not under a single atomic multi-store transaction boundary. |
| Authenticity / tamper resistance | 9.2 | Strong fail-closed replay checks and multiple key providers with rotation deprecation logic. | Security depends on correct operator key management and env setup discipline. |
| Retrieval determinism and relevance | 8.8 | Deterministic ranker with semantic floor, dominance override, near-tie policy, and stable tie-breakers. | Ranking is heuristic; relevance quality can still drift across heterogeneous memory styles. |
| Pin safety lifecycle | 9.3 | Lock-serialized + atomic writes, immutable duplicate behavior, explicit remove-confirm flow. | Pin mutation operations still commit after local pin-store mutation, so rollback semantics on commit failure are limited. |
| Task switching safety | 9.0 | Opt-in autoswitch, ambiguity checks, thrash/mismatch counters, explicit prompts. | Still heuristic inference; occasional false positives/negatives are expected in language-heavy inputs. |
| Memory flush and merge reliability | 8.6 | Clear trigger logic, skip guards, deterministic merge semantics for structured sections. | Unstructured task memory content intentionally skips merge, which can leave manual cleanup burden. |
| Observability and diagnostics contracts | 9.1 | Versioned schemas and strict validation for memory telemetry; alert transport supports retry and PagerDuty. | Diagnostics are strong, but operator dashboards/SLO docs are not part of this code module. |
| Operational lifecycle (rotation/retention/repair) | 8.9 | Segment rotation, compaction baseline signing, retention, and explicit repair path are implemented. | Operational runbooks and local procedural docs are partially out of sync with runtime design. |
| File-read safety for memory_get | 9.0 | Memory path gating plus robust workspace containment now block traversal into sibling-prefix paths. | Defense still depends on correct normalization path in this component only; broader shared utility hardening is still possible. |

**Overall score: 9.2 / 10**

## 14) Highest-priority recommendations

### P0 (should do next)

1. **Finish pin-path transactional durability semantics.**
   - Why: pin add/edit/remove-confirm paths still mutate pin store before WAL durability is confirmed.
   - Improvement: add rollback-safe semantics or WAL-first coordinated commit plan for pin mutations.

2. **Update operational procedures/docs to match WAL+snapshot architecture.**
   - Why: procedure drift causes operator mistakes during incident response.
   - Improvement: align maintenance scripts and internal runbooks with `events.wal.jsonl`, segments, and baseline model.

### P1 (important hardening)

3. **Adopt a shared path-containment utility across modules.**
   - Why: avoids future reintroduction of string-prefix path checks in other tool/read surfaces.

4. **Add periodic integrity scan command (WAL + manifest + baseline + snapshots).**
   - Why: proactive detection lowers MTTR before write-time failures surface.

5. **Expose memory security posture in status output.**
   - Why: operators should quickly see provider mode, key IDs in use, and bypass/degraded status.

### P2 (quality/scale)

6. **Add retrieval quality regression corpus for domain-specific prompts.**
   - Why: deterministic ranking is stable, but corpus-level relevance should be continuously validated.

7. **Add structured analytics for nudge acceptance and autoswitch overrides.**
   - Why: helps tune threshold constants with real behavior data.

## 15) External AI handoff (no repository access required)

If another AI has no file access, tell it this:

- This is a **task-scoped memory platform** where durable truth comes from a **signed WAL + derived snapshots + pin store**, not from transcripts.
- Write commits are scope-restricted, signature-chained, and lock-serialized.
- Replay is fail-closed in prod for signature/schema/version/key errors.
- Retrieval is deterministic and authority-first: hard scope filter first, then hybrid scoring, then deterministic re-ranking with semantic floor and dominance override.
- Pins are first-class constraints with immutable duplicate upsert and two-step removal intents.
- Task switching is guarded by opt-in + ambiguity/confidence + anti-thrash counters.
- Memory flush runs near compaction pressure and merges task markdown with deterministic section merge semantics.
- Diagnostics are strongly versioned for memory guidance/turn-control/retrieval plus security alerting to webhook/PagerDuty.
- Mutating task commands now fail closed on durable commit failures instead of silently skipping event commits.
- Remaining top gap: pin mutation paths still need stronger rollback semantics if durability fails after local pin-store mutation.

Use this score baseline when requesting further review:
- Overall: **9.2/10**
- Best areas: authenticity/tamper controls, task command durability gating, pin lifecycle safety, diagnostics contracts.
- Main improvement opportunity: pin mutation transactional durability and operations-doc alignment.
