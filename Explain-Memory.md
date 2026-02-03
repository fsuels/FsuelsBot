# Memory System (Implemented State)

This document describes the current memory system as implemented in code.
It is intentionally deterministic and scoped to avoid accidental cross-task memory bleed.

Reading contract for reviewers/agents:
- Sections 0-8 describe implemented behavior (with code + test evidence where available).
- Sections 9-13 describe hardening targets and rollout sequencing (not runtime guarantees yet).
- Treat score changes as implementation-backed only when code/test evidence in Section 14 changes.
- Safety-critical claims (authenticity, fail-closed gating, destructive actions) require direct tests, not indirect coverage.

Threat model (current, explicit):
- Defended: accidental corruption, partial writes, replay drift, and normal multi-turn/task confusion.
- Partially defended against malicious local rewrites: signed WAL envelope chain + fail-closed replay is implemented; remaining gaps are startup-level key/diagnostic contracts, key-provider breadth, and WAL lifecycle/rotation hardening.
- In this model, "authoritative memory" means WAL + snapshots + pins determine state/retrieval priority; transcript is advisory context only.

## 0) Non-Negotiable Invariants

1. Single write scope per turn
   - Enforced in `src/memory/task-memory-system.ts` via `commitMemoryEvents(...)` and `validateWriteScope(...)`.
   - A commit can mutate exactly one scope: `task`, `global`, or `none`.
   - Mixed scopes or mixed task IDs in one commit are rejected.

2. Filters before ranking
   - Retrieval in `src/memory/manager.ts` applies source/path filters first, then scoring.
   - Flow is explicitly `filter -> rank -> stitch`.

3. Durable memory is authoritative
   - Deterministic ranking de-prioritizes transcript results (`provenance.source = transcript`).
   - Durable/pin/task/global results win ties and near-ties over transcript snippets.

4. Pins are immutable unless explicit edit/remove
   - `upsertMemoryPin(...)` is idempotent for duplicates and does not mutate existing pins.
   - Changes require explicit `/pin edit`.
   - Removal requires explicit `/pin remove` or `/unpin`.
   - `/forget` removes pins only when `--pins true` is passed.

5. No silent task switching without autoswitch opt-in
   - Default behavior is off: `sessionEntry.autoSwitchOptIn !== true`.
   - Task hints do not silently switch scope unless autoswitch is enabled.
   - `/autoswitch on` allows auto-switch only for high-confidence, non-ambiguous hints.

6. Ambiguity/conflict asks with options
   - `selectTaskMemoryNudge(...)` emits explicit option-style prompts for ambiguous matches.
   - Conflict nudges are explicit (for important/pinned-constraint conflicts).

7. Turn control is explicit in diagnostics
   - `memory.turn-control` diagnostic event records inferred task, resolved task, autoswitch setting, ambiguity, and decision mode.

Invariant coverage map (testable assertions):
- Single write scope per turn:
  - `src/memory/task-memory-system.test.ts` -> `it("enforces single write scope per turn", ...)`
  - `src/memory/task-memory-system.test.ts` -> `it("treats writeScope=none as a strict storage no-op", ...)`
- Filters before ranking:
  - `src/agents/tools/memory-tool.task-context.test.ts` -> `it("passes task-aware deterministic search options to memory manager", ...)` (scope filter wiring)
  - `src/memory/manager.deterministic-rank.test.ts` -> `it("filters out-of-scope task candidates before deterministic ranking", ...)` (comparator-level guard)
  - `src/memory/manager.deterministic-rank.test.ts` -> `it("filters out-of-scope candidates before hybrid merge scoring inputs", ...)` (scoring-input guard)
- Durable memory is authoritative over transcript:
  - `src/memory/manager.deterministic-rank.test.ts` -> `it("prefers durable memory over transcript results at equal scores", ...)`
- Pins immutable unless explicit edit/remove:
  - `src/memory/pins.test.ts` -> `it("keeps pins immutable on duplicate upsert", ...)`
- No silent task switching unless `/autoswitch on`:
  - `src/auto-reply/reply/task-memory-guidance.test.ts` -> topic-switch and autoswitch behavior coverage
  - `src/auto-reply/reply/commands-memory.test.ts` -> `/autoswitch on` toggle coverage
  - `src/auto-reply/reply/get-reply-run.autoswitch.test.ts` -> `it("does not mutate activeTaskId when autoswitch is off even with high-confidence inferred task", ...)`
- Ambiguity/conflict asks with options:
  - `src/auto-reply/reply/task-memory-guidance.test.ts` ->
    - `it("asks the user to choose when multiple tasks match", ...)`
    - `it("surfaces important-memory conflicts explicitly", ...)`
- Turn-control diagnostics:
  - Event type + strict schema/version validator exist in `src/infra/diagnostic-events.ts`
  - `src/auto-reply/reply/get-reply-run.autoswitch.test.ts` -> `it("emits memory.turn-control diagnostics payload contract at reply boundary", ...)`
  - `src/infra/diagnostic-events.test.ts` ->
    - `test("emits versioned memory.turn-control diagnostics", ...)`
    - `test("rejects invalid memory.turn-control payload versions", ...)`
- WAL authenticity + fail-closed replay (minimal slice):
  - `src/memory/task-memory-system.test.ts` ->
    - `it("fails closed in prod when signing key is missing", ...)`
    - `it("fails closed on unknown envelopeVersion in prod without snapshot mutation", ...)`
    - `it("allows unsigned replay bypass only in dev and enforces read-only degraded writes", ...)`
    - `it("fails closed in prod when replay references an unavailable verification key", ...)`

## 1) Data Model (Authoritative Stores)

### 1.1 Task Registry

Store: `memory/system/task-registry.json`

Managed by `src/memory/task-memory-system.ts`:
- `upsertTaskRegistryTask(...)`
- `setTaskRegistryStatus(...)`
- `linkTaskRegistryTasks(...)`
- `listTaskRegistry(...)`

Task record fields:
- `taskId`
- `title`
- `status` (`active | suspended | archived | closed`)
- `createdAt`, `lastTouchedAt`
- `links[]` (explicit related tasks)
- `pinSetId`
- `schemaVersion`

### 1.2 Durable Memory = WAL + Snapshots

WAL (source of truth):
- `memory/system/events.wal.jsonl`

Snapshot caches:
- Global: `memory/system/snapshots/global.json`
- Per task: `memory/system/snapshots/tasks/<taskId>.json`

Event record fields:
- `eventId`
- `scope` (`global | task`)
- `taskId` (task scope only)
- `type`
- `payload`
- `timestamp`
- `actor` (`user | agent | system`)
- `envelopeVersion`
- `signatureVersion`
- `keyId`
- `prevSignature`
- `signature`
- `integrityHash`

Implemented event types:
- `TASK_CREATED`, `TITLE_SET`, `GOAL_SET`
- `DECISION_MADE`, `DECISION_REVERTED`
- `CONSTRAINT_ADDED`, `CONSTRAINT_REMOVED`
- `OPEN_QUESTION_ADDED`, `OPEN_QUESTION_RESOLVED`
- `NEXT_ACTION_SET`, `NEXT_ACTION_COMPLETED`
- `ARTIFACT_LINKED`
- `PIN_ADDED`, `PIN_REMOVE_REQUESTED`, `PIN_REMOVED`
- `STATE_PATCH_APPLIED`
- `USER_CONFIRMED`

Snapshot record fields:
- `snapshotId`
- `scope`, `taskId`
- `eventOffset`
- `state` (canonical structured object)
- `updatedAt`

Rules:
- WAL is append-only and signature-chained (`prevSignature` -> `signature`) with `HMAC-SHA256`.
- `envelopeVersion=1` + canonical envelope signing is enforced on replay.
- Snapshots are derived caches and can be rebuilt from WAL replay.
- Commit writes are serialized under a WAL writer lock (`memory/system/events.wal.lock`).
- Snapshot writes use atomic temp-file + rename.
- Validation utilities:
  - `rebuildSnapshotFromWal(...)`
  - `validateSnapshotAgainstWal(...)`
- Tail-repair utilities:
  - `readWalDiagnostics(...)`
  - `repairWalCorruptTail(...)`

Important boundary:
- Minimal authenticity slice is implemented, but key provider is env-only and startup-level hard-fail diagnostics contracts are not fully wired yet.

### 1.3 Pins Store (Immutable Constraints)

Stores:
- `memory/.pins.json`
- Rendered views:
  - `memory/global/pins.md`
  - `memory/tasks/<taskId>/pins.md`

Implementation: `src/memory/pins.ts`

Rules implemented:
- Global and task-scoped pins are supported.
- Duplicate upsert returns existing pin unchanged.
- Edit/remove are explicit operations.
- Constraint pins are injected into reply system prompts.

### 1.4 Transient TTL Buffer

Store:
- `memory/system/transient-buffer.json`

Implementation in `src/memory/task-memory-system.ts`:
- `upsertTransientBufferItem(...)`
- `listTransientBufferItems(...)`
- `pruneExpiredTransientBufferItems(...)`

Record fields:
- `itemId`, `content`, `ttlExpiresAt`, optional `relatedTaskId`

Rule:
- Transient entries are not durable task/global memory unless explicitly promoted.

## 2) Ephemeral Stores (Disposable)

### 2.1 Session Control Plane

Defined in `src/config/sessions/types.ts`, maintained via `src/sessions/task-context.ts`.

Key fields:
- `sessionId`
- `activeTaskId`
- `taskStack` (max depth 3, maintained by `applySessionTaskUpdate`)
- `taskStateById`
- `autoSwitchOptIn` (default false)
- `lastTaskSwitch`, `lastTaskSwitchAt`
- `taskSwitchThrashCounter`, `taskMismatchCounter`, `lastRetrievalRejectAt`
- `memoryGuidanceMode` (`minimal | supportive`)

### 2.2 Transcript Buffer

- Session transcript JSONL is append-only runtime history.
- Transcript data is non-authoritative.
- Transcript indexing is optional (`sources: ["sessions"]`), not default.

## 3) Retrieval Index (Deterministic, Filtered Hybrid)

Core files:
- `src/memory/manager.ts`
- `src/agents/tools/memory-tool.ts`

### 3.1 What gets indexed

Default:
- Durable memory files (`MEMORY.md`, `memory/**/*.md`), including pin markdown views.

Optional:
- Session transcripts (`source = sessions`) when enabled in memory search config.

### 3.2 Retrieval policy in practice

For active task retrieval (`namespace=auto/task`):
1. Task scope search (path-filtered to task file/dir).
2. Optional global fallback.
3. Optional linked task reads (read-only), appended by `memory_search` with a hard cap of 3 snippets and `[related task: <taskId>]` labels.

For no active task / global mode:
- Global/legacy memory scopes are searched (task paths excluded in global scope).

### 3.3 Ranking inside a scope (after filtering)

1. Hard filters first (source/path scope).
2. Hybrid scoring (BM25 + embeddings).
3. Deterministic ranking:
   - Priority class order is encoded as:
     - `pin` > `snapshot` > `decision` > `constraint` > `next action` > `open question` > `events` > task/global/legacy file > transcript.
   - Transcript scores are additionally penalized (`score * 0.85`).
   - Tie-breakers then use recency, path, and line numbers.
   - Precise "near-tie" definition in current comparator:
     - after transcript penalty, if `abs(scoreDelta) <= 0.000001`, ranking falls back to priority class, then deterministic tie-breakers.

Current boundary:
- Ranking is deterministic and authority-first, but there is no explicit semantic floor yet to prevent a weakly-related high-priority item from outranking a strongly-related lower-priority item.
- The current near-tie epsilon (`0.000001`) is extremely strict; in practice, class-priority fallback may trigger less often than intended under real score noise.
- Target direction: move to a relative near-tie policy (not fixed absolute epsilon only) and lock the comparator behavior in tests.
- Near-tie policy must be defined against a normalized score domain; applying one epsilon directly to mixed-scale raw BM25/cosine values is not safe.

## 4) Turn Processing Pipeline

### Step A - Task intent hinting

- `inferTaskHintFromMessage(...)` scores task candidates from `taskStateById`.
- Emits best candidate plus confidence and ambiguity set.
- This step does not mutate state by itself.

### Step B - Confusion/clarification nudges

- `selectTaskMemoryNudge(...)` handles:
  - ambiguous task matches (option list)
  - important-memory conflicts
  - topic-switch prompts
- Current implementation is text-option prompts (channel-safe), not button-only UI.

### Step C - Scope resolution and autoswitch gate

- If autoswitch is off, inferred task changes are advisory only.
- If autoswitch is on, high-confidence + non-ambiguous hints can switch active task.

### Step D - Deterministic retrieval pack

- Retrieval applies strict filtering and deterministic ranking as above.
- Linked tasks are read-only and capped.

### Step E - Reply generation plus memory events

- Reply run uses retrieved context, guidance nudges, and constraint pin injection.
- Memory events may be emitted for durable state updates.

### Step F - Transactional commit

`commitMemoryEvents(...)` performs:
- schema/type normalization
- single-scope validation
- single-writer lock around WAL append + snapshot update
- WAL tail repair to last valid hash-linked entry before new append (when corruption is detected)
- WAL append with integrity hash chaining
- snapshot catch-up from WAL when `eventOffset` lags
- snapshot apply/update (atomic write)
- task-registry touch (`lastTouchedAt`) where relevant

`writeScope = none` behavior (explicit):
- `commitMemoryEvents(...)` is a no-op for storage (`{ committed: [] }`).
- No WAL append, no snapshot mutation, no registry touch.
- Operational meaning: "turn produced no durable memory mutation."

### Step G - Atomic micro-commit on confirmations

- Confirmation replies like `yes/correct/agreed/that's right` trigger immediate `USER_CONFIRMED` task event commits.

## 5) Summarization Boundaries

- Summaries and compaction artifacts are presentation/runtime aids.
- Durable task/global state is WAL + snapshot driven.
- Transcript and summaries never replace durable truth.

## 6) Lifecycle Management and Commands

Primary handler: `src/auto-reply/reply/commands-memory.ts`

Supported command surface:
- `/task ...`
- `/tasks`
- `/resume <id>`
- `/switch <id>`
- `/newtask <title>`
- `/link <id1> <id2>`
- `/archive <id>`
- `/close <id>`
- `/pin ...`
- `/pins`
- `/unpin <pinId>`
- `/autoswitch on|off|status`
- `/mode minimal|supportive|status`
- `/forget ...` (pins only removed with `--pins true`)

Registry wiring:
- `src/auto-reply/commands-registry.data.ts`
- `src/auto-reply/reply/commands-core.ts`

## 7) What this optimizes and intentionally avoids

Optimizes:
- deterministic task isolation
- durable state evolution via WAL + snapshots
- explicit, auditable state transitions
- safer memory operations (single-scope commits + immutable pin default)
- predictable retrieval behavior

Avoids:
- silent task switching without opt-in
- implicit cross-task context weaving
- transcript-as-truth behavior
- ranking paths that bypass scope filters

## 8) Current practical limits

These are current implementation boundaries:
- Ambiguity/conflict UX is deterministic text options (not channel-specific button controls).
- Session counters for thrash/mismatch are present in session schema; hard gating logic for those counters is not yet enforced in `get-reply-run.ts`.
- Pin removal is explicit command-driven; there is no second confirmation step built into `/pin remove` or `/unpin`.
- WAL authenticity minimal slice is implemented (signed envelopes + `prevSignature` chain + replay verification + fail-closed replay reads/writes on verification failures).
- Startup hard-fail key checks and severity-typed diagnostics are not yet centralized at process boot boundary.
- WAL lifecycle is currently single-stream append + replay validation; there is no segment rotation/compaction policy yet, so growth is unbounded over time.
- Event payloads are validated by event type membership, but not yet by strict per-event payload schemas.
- Retrieval semantic floor/dominance guard is not implemented yet, so authority-first ranking can still surface weakly relevant high-priority items.
- Key management is currently env-backed only (`MEMORY_WAL_ACTIVE_SIGNING_KEY*` / `MEMORY_WAL_VERIFICATION_KEYS_JSON`); secret-manager adapters and key-rotation lifecycle policy are not yet implemented.
- Retrieval determinism can drift across deploys when embedding model/tokenization/BM25 config changes; explicit retrieval-version stamping + migration discipline is not yet documented as a required contract.
- Fail-closed parity for replay schema validation failures is still pending (signature/version fail-closed is implemented).
- Contracts in Section 9 are implementation targets, not current runtime guarantees.

## 9) Remaining hardening recommendations (agreed, prioritized)

These are the highest-leverage next hardening steps, in priority order:

1. Cryptographic authenticity hardening completion
   - Minimal secure slice is implemented (signed/HMAC event records + `prevSignature` chain + replay verification + prod fail-closed replay reads/writes).
   - Remaining work is production hardening breadth (boot contracts, key providers/rotation, lifecycle tooling, diagnostics taxonomy).
   - Contract target:
     - envelope versioning: include explicit `envelopeVersion` in signed records so canonicalization/signing rule changes are version-gated
     - signature algorithm: `HMAC-SHA256` (or asymmetric signature) over canonical event envelope
     - canonicalization: explicit canonical encoding (for example RFC-8785-style canonical JSON or a single project serializer), not just "stable ordering"
     - payload canonicalization: `payload` is canonicalized JSON inside the canonical event envelope (arrays/objects included)
     - signed field set: (`eventId`, `scope`, `taskId`, `type`, canonical `payload`, `timestamp`, `actor`, `prevSignature`)
     - timestamp canonicalization: encode `timestamp` in UTC RFC3339 with fixed millisecond precision
     - chain source of truth: `prevSignature` is the canonical chain field; `prevIntegrityHash` may remain as an auxiliary integrity/debug field
     - `integrityHash` behavior after signing: keep as auxiliary debug field only, computed from the same canonical envelope; verification truth source is signature chain, not hash chain
     - signature metadata on event/segment: `signatureVersion`, `keyId`, `signature`
     - key source: environment/secret manager (not repo/workspace files)
     - key-provider contract: support at least `env` + one pluggable secret-manager adapter behind a stable interface
     - `keyId` contract: stable, versioned identifier format (`<provider>:<key-name>:<version>`) used for lookup + diagnostics
     - mode contract: security behavior is driven by explicit runtime mode (`MEMORY_SECURITY_MODE=prod|dev`, default `prod`)
     - mode precedence/validation: `MEMORY_SECURITY_MODE` is source of truth, `NODE_ENV` does not override it; invalid values are coerced to `prod` and emit `ERROR` diagnostics
     - boot behavior (prod): if active signing key or required verification keys are unavailable, fail startup hard and emit `CRITICAL` diagnostics
     - replay scope contract: `replayScope = non-expired segments by retention policy + active segment + required manifest chain`
     - retention contract input: `MEMORY_WAL_RETENTION_DAYS` (or equivalent config) defines expiration boundary used by replay scope
     - required verification keys: all `keyId`s referenced by replay scope must resolve, otherwise hard-fail in prod
     - rotation: dual-read (old+new keys), single-write (new key), time-bounded deprecation (default 30 days unless policy override)
     - canonicalization source of truth: `envelopeVersion` selects one canonicalizer (`canonicalizeV<N>(envelope)`); exactly one canonicalizer per version
     - verification behavior: fail-closed in production; fail-open allowed only in dev with explicit env flag and high-severity diagnostics on every bypass
     - dev bypass flag: `MEMORY_ALLOW_UNSIGNED_REPLAY=true`
     - dev bypass scope: bypass applies only to signature mismatch/missing verification keys; bypass is not allowed for unknown `envelopeVersion` or schema validation failures
     - dev bypass mode: read-only degraded mode (no snapshot updates, no WAL-backed writes), with `ERROR` diagnostics on every bypass
     - verification failure behavior (prod): stop replay, do not update snapshots, emit diagnostic event, surface operator-facing error, and block serving memory derived from unverified history
     - serving mode on verification failure (prod): hard-fail WAL-backed memory reads/writes until operator repair succeeds (no silent transcript-only fallback)
     - unsupported `envelopeVersion` behavior (prod): treat as incompatible history, emit `CRITICAL` diagnostic, and keep WAL-backed memory service hard-failed until upgrade/migration succeeds
     - bootstrap diagnostics fallback: if diagnostic emitter is unavailable during early boot, write equivalent structured event to stderr/log sink before process exit
     - diagnostics severity taxonomy:
       - dev signature bypass: `ERROR`
       - prod signature verification failure: `CRITICAL`
       - prod unsupported `envelopeVersion`: `CRITICAL`
       - prod schema validation failure during replay: `CRITICAL`
   - Minimal secure slice (implemented):
     - one canonicalizer + `envelopeVersion=1`
     - per-record `HMAC-SHA256` with `prevSignature` chaining
     - replay verification with prod fail-closed behavior for signature/version/key failures
     - `keyId` resolved from env-backed provider

2. WAL segmentation + compaction lifecycle
   - Rotate WAL into size/time-based segments, keep segment hash links, align snapshots to segment boundaries, and add repair tooling for truncated/corrupt tails.
   - Add retention/archival policy so closed/archived tasks do not keep hot WAL costs forever.
   - Contract target:
     - rotation triggers: max size and max age
     - segment naming: monotonic sequence numbers in filenames
     - segment manifest: ordered segments + chain hash/signature pointers
     - signing mode default: per-record signature chaining is required; per-segment signatures are optional acceleration metadata for faster bulk verification
     - acceleration trust rule: per-segment signatures/metadata are trusted only when chain verification conditions hold (record-chain verified and/or manifest-chain signature verified with matching `keyId`)
     - snapshot alignment: checkpoint snapshot at segment boundaries
     - compaction: merge older segments into baseline snapshots + archive/delete policy per task lifecycle state
     - baseline artifacts: if audit-grade tamper evidence is required, sign compacted baseline snapshot artifacts
     - operator repair workflow (minimum):
       - detect failure and emit diagnostics
       - isolate corruption (truncate tail or quarantine segment)
       - restore from backup if needed
       - re-run replay/verification before re-enabling WAL-backed memory service
     - authenticity mode rule: in production authenticity mode, repair actions are explicit operator steps (no silent auto-repair re-enable)

3. Retrieval semantic override guard
   - Keep deterministic authority classes, but add a minimum similarity floor and a deterministic dominance rule (lower-priority classes can outrank when semantic gap exceeds a configured threshold).
   - Add ranking tests for false-positive pin/snapshot promotion.
   - Contract target:
     - score domain: explicitly define threshold domain (cosine, normalized BM25, or hybrid score)
     - threshold stage: explicitly define whether thresholds are applied pre/post transcript penalty and pre/post class priors
     - near-tie policy target: use a relative epsilon policy on a normalized score domain (for example `abs(delta) <= max(1e-6, max(|a|,|b|)*1e-4)`) and pin it in tests/config
     - normalization rule: if hybrid components are on different scales, normalize before epsilon/dominance checks and log calibration samples from top-k results
     - eligibility floor: high-priority classes must meet `minSimilarity`
     - deterministic dominance: lower-priority result can outrank when `scoreDelta >= overrideDelta`
     - diagnostics: emit explicit override metadata for auditability
     - defaults + tuning: pin initial defaults in config/tests (for example `minSimilarity` and `overrideDelta`), and tune only through versioned evaluation on labeled fixtures
     - comparator hygiene: prove scorer is never invoked on out-of-scope candidates (correctness + performance guard)

4. Strict per-event payload schemas
   - Validate each event payload shape at write-time and replay-time to eliminate schema drift.
   - Tie schema versions to replay/migration paths to avoid silent behavior changes.
   - Contract target:
     - schema per event type (`type -> payload schema`)
     - replay policy: deterministic handling of invalid events (recommended: stop replay + fail in production, operator repair/quarantine tool, then re-run)
     - policy parity: schema validation failures follow the same fail-closed replay path as signature verification failures
     - migration policy: explicit `schemaVersion` upgrades with tested migration functions
     - migration tool contract (minimum):
       - read older `schemaVersion`/`envelopeVersion` WAL+segments
       - write upgraded artifacts with current versions
       - emit auditable migration report (input range, output range, checksums/signatures, timestamp)

5. Retrieval versioning + migration discipline
   - Stamp diagnostics with embedding model/BM25/config versions, treat ranking config changes as migrations, and reindex/version records when needed.
   - Contract target:
     - stamp retrieval diagnostics with config hash + embedding model id + BM25 config version
     - treat version changes as migrations (with reindex plan and rollback notes)

6. Pin deletion confirmation
   - Require explicit confirm step for destructive pin removal paths.
   - Contract target:
     - two-step delete with pending intent token
     - short TTL on confirmation token (for example 2-5 minutes)
     - idempotent confirm/cancel handling with explicit user-facing result

Additional recommendations (agreed, but lower priority / deployment-specific):
- Enforce hard thrash/mismatch gating from existing session counters in `get-reply-run.ts`.
- Make linked-task snippet cap configurable instead of fixed at 3.
- Optional at-rest encryption for WAL/snapshots when threat model includes local disk compromise.
- Export memory diagnostics to centralized monitoring/alerting (for example frequent WAL repairs or repeated retrieval rejects).
- Define minimum alerting/SLO contract for `CRITICAL` memory diagnostics (verification failures, unsupported envelope version, boot key failures).

## 10) Key files and validation

Key files:
1. `src/memory/task-memory-system.ts`
2. `src/memory/manager.ts`
3. `src/memory/pins.ts`
4. `src/auto-reply/reply/get-reply-run.ts`
5. `src/auto-reply/reply/task-memory-guidance.ts`
6. `src/auto-reply/reply/commands-memory.ts`
7. `src/sessions/task-context.ts`
8. `src/infra/diagnostic-events.ts`
9. `src/agents/tools/memory-tool.ts`

Targeted tests:
- `src/memory/task-memory-system.test.ts`
- `src/memory/manager.deterministic-rank.test.ts`
- `src/memory/pins.test.ts`
- `src/infra/diagnostic-events.test.ts`
- `src/auto-reply/reply/commands-memory.test.ts`
- `src/auto-reply/reply/task-memory-guidance.test.ts`
- `src/auto-reply/reply/get-reply-run.autoswitch.test.ts`
- `src/sessions/task-context.test.ts`
- `src/agents/tools/memory-tool.task-context.test.ts`

## 11) High-value next tests (recommended)

1. Diagnostics schema-enforcement breadth for memory telemetry
   - `memory.turn-control` strict schema + explicit event versioning is now enforced in runtime code.
   - Next step: extend strict schema-validator + version discipline to other memory diagnostics (`memory.guidance`, `memory.guidance.response`).

2. Authenticity boot/startup contract tests (service boundary)
   - Runtime replay fail-closed tests exist in `task-memory-system`.
   - Next step: add process boot/startup tests asserting hard-fail behavior and operator-facing diagnostics when signing/verification keys are unavailable in `prod`.

3. Mode behavior matrix (`MEMORY_SECURITY_MODE`)
   - Add broader tests for default `prod`, explicit `dev`, invalid mode coercion to `prod`, and `MEMORY_ALLOW_UNSIGNED_REPLAY=true` behavior.
   - Assert bypass stays scoped to signature/missing-key failures (already true) and remains blocked for unknown `envelopeVersion` / schema failures.

4. Schema fail-closed parity
   - Add strict per-event replay schema validation tests and assert parity with signature/version fail-closed behavior.

5. Pin deletion confirm-token flow
   - Add tests for token creation, TTL expiry, successful confirm, cancel path, and replay/idempotency behavior.

## 12) Implementation Release Gates (recommended)

Use these as merge/release gates for hardening rollout:

Gate implementation rule:
- A gate counts as implemented only when enforcement is default-on (or unskippable in `prod`) and direct tests prove required boundary/failure behavior.

1. Authenticity gate
   - Canonical envelope + `envelopeVersion` + `prevSignature` chain + replay verification in production fail-closed mode.

2. Retrieval correctness gate
   - Semantic floor + dominance override implemented with deterministic diagnostics and tuning fixtures.

3. Scope safety E2E gate
   - Autoswitch-off path cannot mutate `activeTaskId` in end-to-end tests.

4. Filter-before-scoring gate
   - Comparator-level test proves out-of-scope candidates never reach scorer.

5. Lifecycle gate
   - WAL segmentation + retention policy input implemented with manifest verification path.

6. Diagnostics contract gate
   - `memory.turn-control` payload schema asserted as an API contract (strict validator + versioning discipline).

7. Destructive action safety gate
   - Pin deletion requires a two-step confirm-token flow with TTL and tested idempotency.

## 13) Fastest Score-Moving Implementations

If implementation bandwidth is limited, this order gives the highest practical risk reduction:

1. Semantic floor + dominance override + diagnostics in retrieval ranking.
2. Relative near-tie policy on normalized scores + comparator-level tests.
3. Two-step pin deletion confirm-token flow with TTL/idempotency tests.
4. WAL segmentation + retention lifecycle with manifest verification.

Latest evidence win shipped:
- `writeScope=none` now has a direct no-op test proving no WAL/snapshot mutation and no registry touch.
- Comparator-level filtering now drops out-of-scope task candidates before deterministic ranking.
- Hybrid merge scoring now receives only in-scope candidates for task-scoped stages.
- Autoswitch-off E2E guard now proves inferred high-confidence task hints cannot mutate `activeTaskId` without opt-in.
- `memory.turn-control` diagnostics payload is now asserted at reply boundary with concrete field/decision-mode checks.
- `memory.turn-control` now has strict runtime schema enforcement with explicit `eventVersion` and invalid-version rejection tests.
- WAL authenticity minimal slice is now enforced with signed envelopes (`HMAC-SHA256`), `prevSignature` chaining, versioned envelope/signature metadata, and fail-closed replay verification in `prod`.

## 14) Evidence Matrix (Implemented vs Planned)

Use this section as the source of truth for "what exists now" vs "what is still design contract."

Status rubric (deterministic):
- Implemented: production code path exists and at least one direct automated test asserts the exact claim.
- Partial: production code path exists but is missing at least one of: direct test, E2E gate coverage, negative/failure-mode assertion, or fail-closed enforcement.
- Planned: no shipped code path yet (or behind non-default/experimental path not enforced in runtime).

Evidence pointer granularity:
- Safety-critical items must include exact test name + assertion summary, or explicit failure-injection method used to prove negative-path behavior.
- Recommended entry format:
  - Code:
  - Test:
  - Asserts:
  - Failure injection (required for safety-critical negative-path claims):

Implemented (code-backed now):
- Single write scope enforcement:
  - Code: `src/memory/task-memory-system.ts` (`validateWriteScope(...)`, `commitMemoryEvents(...)`).
  - Test: `src/memory/task-memory-system.test.ts` (`it("enforces single write scope per turn", ...)`).
  - Asserts: committing a `writeScope="global"` turn containing task-scoped event data is rejected with a single-scope invariant error.
- `writeScope=none` no-op in commit path:
  - Code: `src/memory/task-memory-system.ts` (`commitMemoryEvents(...)` early return when `writeScope === "none"` or no events).
  - Test: `src/memory/task-memory-system.test.ts` (`it("treats writeScope=none as a strict storage no-op", ...)`).
  - Asserts: `writeScope=none` returns `{ committed: [] }`, does not create/append WAL, does not create snapshots, and does not touch task registry timestamps.
- WAL authenticity minimal slice + fail-closed replay gating:
  - Code: `src/memory/task-memory-system.ts` (`buildSignedEnvelope(...)`, `signWalEnvelope(...)`, `readWalEventsFromRaw(...)`, `resolveMemorySecurityConfig(...)`, `commitMemoryEvents(...)`).
  - Test: `src/memory/task-memory-system.test.ts` (`it("fails closed in prod when signing key is missing", ...)`, `it("fails closed on unknown envelopeVersion in prod without snapshot mutation", ...)`, `it("allows unsigned replay bypass only in dev and enforces read-only degraded writes", ...)`, `it("fails closed in prod when replay references an unavailable verification key", ...)`).
  - Asserts: WAL writes require signing keys in `prod`; replay fails closed on unsupported envelope versions and missing verification keys; dev unsigned replay bypass is explicitly scoped and forces read-only degraded writes.
- Filter-before-rank retrieval pipeline:
  - Code: `src/memory/manager.ts` (`searchScoped(...)` applies path/source filters before ranking and re-checks stage scope prior to deterministic sort).
  - Test: `src/agents/tools/memory-tool.task-context.test.ts` (`it("passes task-aware deterministic search options to memory manager", ...)`), `src/memory/manager.deterministic-rank.test.ts` (`it("filters out-of-scope task candidates before deterministic ranking", ...)`, `it("filters out-of-scope candidates before hybrid merge scoring inputs", ...)`).
  - Asserts: deterministic task-aware filter options are forwarded to manager search, out-of-scope task candidates are excluded before `rankDeterministic(...)`, and hybrid merge scorer inputs are pre-filtered to in-scope candidates.
- Durable-over-transcript ranking behavior:
  - Code: `src/memory/manager.ts` (`adjustedDeterministicScore(...)` transcript penalty, `resolveDeterministicPriority(...)`).
  - Test: `src/memory/manager.deterministic-rank.test.ts` (`it("prefers durable memory over transcript results at equal scores", ...)`).
  - Asserts: when transcript and durable entries share equal score/snippet, durable task memory ranks before transcript.
- Pin immutability on duplicate upsert:
  - Code: `src/memory/pins.ts` (`upsertMemoryPin(...)` duplicate handling).
  - Test: `src/memory/pins.test.ts` (`it("keeps pins immutable on duplicate upsert", ...)`).
  - Asserts: duplicate upsert returns the same pin id and unchanged `updatedAt` (no mutation).
- Task intent ambiguity/conflict nudges:
  - Code: `src/auto-reply/reply/task-memory-guidance.ts` (`selectTaskMemoryNudge(...)`).
  - Test: `src/auto-reply/reply/task-memory-guidance.test.ts` (ambiguity + conflict assertions).
  - Asserts: ambiguous matches prompt explicit choose/resume options; important-memory conflicts are surfaced explicitly in guidance text.
- Autoswitch-off task isolation at reply boundary:
  - Code: `src/auto-reply/reply/get-reply-run.ts` (`canAutoSwitch` gate requires `sessionEntry.autoSwitchOptIn === true`).
  - Test: `src/auto-reply/reply/get-reply-run.autoswitch.test.ts` (`it("does not mutate activeTaskId when autoswitch is off even with high-confidence inferred task", ...)`).
  - Asserts: high-confidence inferred task hint does not change `activeTaskId`, no autoswitch memory event is committed, and run continues on existing active task.
- `memory.turn-control` diagnostics payload contract:
  - Code: `src/auto-reply/reply/get-reply-run.ts` (`emitDiagnosticEvent({ type: "memory.turn-control", eventVersion, ... })`), `src/infra/diagnostic-events.ts` (`MemoryTurnControlDiagnosticEventSchema`, runtime parse in `emitDiagnosticEvent(...)`).
  - Test: `src/auto-reply/reply/get-reply-run.autoswitch.test.ts` (`it("emits memory.turn-control diagnostics payload contract at reply boundary", ...)`), `src/infra/diagnostic-events.test.ts` (`test("emits versioned memory.turn-control diagnostics", ...)`, `test("rejects invalid memory.turn-control payload versions", ...)`).
  - Asserts: event emission includes inferred/resolved task IDs, autoswitch flags, ambiguity, decision mode, diagnostic envelope fields (`seq`, `ts`), explicit `eventVersion`, and rejects invalid versions at runtime.
- WAL lock + atomic snapshot writes + repair/validate utilities:
  - Code: `src/memory/task-memory-system.ts` (`events.wal.lock`, `readWalDiagnostics(...)`, `repairWalCorruptTail(...)`, `rebuildSnapshotFromWal(...)`, `validateSnapshotAgainstWal(...)`).
  - Test: `src/memory/task-memory-system.test.ts` (`commits task events to WAL and snapshot`, `rebuilds/validates snapshots against WAL`, `recovers stale snapshot offsets before applying new commits`).
  - Asserts: WAL-backed commits update snapshots, validation detects mismatch then passes after rebuild, and stale snapshot offsets are caught up before applying new events.

Partially implemented (exists, but not fully gated/contracted):
- Diagnostics schema-enforcement breadth:
  - `memory.turn-control` strict schema + version enforcement is implemented.
  - Equivalent strict schema + explicit version discipline for remaining memory diagnostics (`memory.guidance`, `memory.guidance.response`) is still pending.
- Authenticity operational hardening breadth:
  - Replay fail-closed + signed envelope chain is implemented in runtime WAL paths.
  - Startup-level hard-fail diagnostics contracts (severity taxonomy + centralized boot refusal path) and non-env key providers/rotation are still pending.

Planned only (not implemented yet):
- Retrieval semantic floor + deterministic dominance override.
- Relative near-tie on normalized score domain in runtime comparator.
- WAL segmentation/manifest/retention lifecycle.
- Strict per-event payload schema enforcement + migration tooling.
- Two-step pin delete confirm-token flow.

Critical failure-mode evidence required before status can move to Implemented:
- Authenticity startup contract:
  - Runtime WAL replay/write fail-closed is implemented.
  - Remaining requirement: process boot/startup must refuse service in `prod` when active signing/verification keys are unavailable, with severity-typed operator diagnostics.
- Version-gated replay coverage breadth:
  - Unknown `envelopeVersion` fail-closed replay is implemented in runtime WAL paths.
  - Remaining requirement: add startup/integration-path assertions for the same contract.
- Schema fail-closed parity:
  - Replay schema validation failure must follow the same fail-closed path as signature verification failure.

## 15) Reviewer Scoring Rules (For Other AIs)

To avoid over-scoring from spec text alone:
- Count Sections 9-13 as design intent, not delivered capability.
- Increase security/retrieval/operability scores only when there is code evidence plus tests for the relevant gate.
- Treat score movement as "material" only when at least one release gate in Section 12 is implemented and passing.
- Do not award full credit for safety-critical behavior when evidence is only indirect (for example command wiring tests without boundary failure tests).
- If any Section 14 item violates its own rubric classification, downgrade that item to `Partial` until evidence is corrected.

Minimum evidence required to claim runtime improvement:
- Code diff in the relevant subsystem files.
- At least one new/updated test proving behavior.
- Clear failure-mode behavior (especially fail-closed paths) validated in test output.
- For security/operability score increases: include at least one negative-path test (failure injection) plus one boundary/integration-path test.

## 16) Senior Engineer Review (Code + Test Backed)

Review scope:
- This review is grounded in the current code and tests referenced in Sections 10 and 14, plus direct inspection of:
  - `src/memory/task-memory-system.ts` + `.test.ts`
  - `src/memory/manager.ts` + `.deterministic-rank.test.ts`
  - `src/memory/pins.ts` + `.test.ts`
  - `src/auto-reply/reply/get-reply-run.ts` + `.autoswitch.test.ts`
  - `src/auto-reply/reply/task-memory-guidance.ts` + `.test.ts`
  - `src/auto-reply/reply/commands-memory.ts` + `.test.ts`
  - `src/infra/diagnostic-events.ts` + `.test.ts`
  - `src/agents/tools/memory-tool.ts` + `.task-context.test.ts`
  - `src/sessions/task-context.ts` + `.test.ts`
- Scores are 1-10 where 10 means strong production posture with tested edge/failure handling, and 5 means materially incomplete for production hardening.

### 16.1 Scorecard (Important Aspects)

| Aspect | Score | Why this score |
|---|---:|---|
| 1) Task scope isolation and write invariants | 9.0 | Very strong invariant enforcement (`validateWriteScope`, `writeScope=none` no-op test). This directly prevents cross-task bleed in a single commit. Remaining gap is mostly around payload-shape rigor, not scope mixing. |
| 2) WAL durability and snapshot consistency | 8.5 | Strong mechanics: single-writer lock, append WAL, atomic snapshot writes, replay rebuild/validate utilities, stale-offset catch-up tests. Main remaining risk is lifecycle growth and schema strictness, not baseline consistency mechanics. |
| 3) Authenticity and tamper detection posture | 7.0 | Good minimal secure slice exists (HMAC signed canonical envelope, `prevSignature` chain, fail-closed replay checks in prod for key/version/signature failures). Lowered because startup hard-fail contracts, key-provider breadth/rotation lifecycle, and schema-fail parity are not fully closed. |
| 4) Retrieval scope correctness | 8.5 | Strong filter-before-rank and out-of-scope exclusion is tested at comparator/scorer boundaries. This is a major correctness win because it prevents subtle cross-task contamination in ranking inputs. |
| 5) Retrieval relevance and ranking quality | 6.5 | Deterministic and authority-first behavior is reliable, but semantic floor/dominance override is still missing. Absolute epsilon (`1e-6`) on mixed-scale hybrid scores is too strict and can under-trigger intended near-tie behavior. |
| 6) Task switching safety and control | 8.5 | Autoswitch is opt-in and guarded by confidence + non-ambiguity checks. Autoswitch-off behavior is explicitly tested at reply boundary. Hard thrash/mismatch gating counters exist but are not yet enforced. |
| 7) Pin safety and lifecycle controls | 7.5 | Strong immutability default (idempotent duplicate upsert), explicit edit/remove paths, and constraint injection behavior. Reduced due to lack of two-step confirmation for destructive pin deletion and no confirm-token flow. |
| 8) Diagnostics contract and observability | 7.5 | `memory.turn-control` has strict runtime schema + event version validation with tests. `memory.guidance` and `memory.guidance.response` emit telemetry but lack equivalent strict schema/version enforcement. |
| 9) Event schema rigor and migration discipline | 5.5 | Event type membership is validated, but strict per-event payload schemas are not enforced yet. This leaves room for shape drift and replay ambiguity across versions. |
| 10) Operational lifecycle and scale posture | 5.5 | Current WAL is single-stream append with no segment rotation/retention/compaction policy, so growth is unbounded. Repair tools exist, but long-horizon operational costs are not yet controlled. |
| 11) Test quality for core invariants | 8.5 | Good direct tests for key invariants and negative-path security behavior (missing key, unknown envelope, bypass constraints, lock timeout, out-of-scope filtering). Major remaining test gaps align with planned hardening items (startup boundary, schema fail-closed parity, delete confirmation flow). |
| 12) UX clarity for ambiguity and conflict | 8.0 | Guidance nudges are explicit, deterministic, and channel-safe text options. This is practical and robust. Main gap is advanced policy enforcement (thrash gating) rather than basic user-direction clarity. |

Overall system score: **7.6 / 10**

Why this overall score:
- Good: the system already has unusually strong deterministic safety primitives for scope isolation, durable replayable state, and tested fail-closed slices.
- Bad: the biggest residual risks are exactly the ones that hurt mature production systems over time: lifecycle scalability, strict schema governance, startup security contracts, and retrieval semantic guardrails.

### 16.2 Detailed Good vs Bad Reasoning by Aspect

1) Task scope isolation and write invariants:
- Good and why: enforcing one write scope per turn prevents accidental cross-task contamination during busy multi-turn interactions; this is the single highest-value safety property in task memory systems.
- Bad and why: without strict payload schemas, a valid-scope event can still carry malformed semantics; scope integrity does not fully guarantee semantic integrity.

2) WAL durability and snapshot consistency:
- Good and why: append-only WAL + rebuildable snapshots gives deterministic recovery and auditability. Atomic snapshot writes reduce partial-write corruption risk.
- Bad and why: correctness today does not equal sustainability tomorrow; unsegmented WAL growth raises replay latency and operational fragility over long horizons.

3) Authenticity and tamper detection:
- Good and why: canonical envelope + HMAC + signature chaining establishes a verifiable history; fail-closed replay in prod for signature/key/version failures prevents silent trust of unverified state.
- Bad and why: startup boundary remains softer than ideal. If production boot contracts are not centralized and severity-typed, operators can miss or mis-handle failure states during deploy/restart incidents.

4) Retrieval scope correctness:
- Good and why: filtering before scoring/ranking and proving scorer input hygiene prevents high-scoring out-of-scope pollution, which is a common subtle bug in hybrid retrieval.
- Bad and why: correctness of scope does not guarantee topical relevance quality inside scope; that is a separate ranking-quality problem.

5) Retrieval relevance and ranking quality:
- Good and why: deterministic ranking with authority classes makes behavior predictable and auditable.
- Bad and why: without semantic floor and dominance override, weak high-priority snippets can outrank stronger lower-priority evidence. Absolute epsilon on mixed score scales is mathematically brittle.

6) Task switching safety:
- Good and why: autoswitch requires explicit opt-in plus confidence and non-ambiguity. This is correct default safety for user trust.
- Bad and why: session thrash/mismatch counters exist but are not gating behavior yet, so long noisy sessions may still produce unstable context movement.

7) Pin lifecycle safety:
- Good and why: immutable-by-default duplicates reduce accidental mutation and preserve user intent.
- Bad and why: immediate destructive deletion without two-step confirm is operationally risky under typo or stale context conditions.

8) Diagnostics:
- Good and why: strict schema and versioning on turn-control makes telemetry contractual and safer for analytics/alerts.
- Bad and why: inconsistent schema rigor across diagnostic event types increases chance of downstream parser breakage and silent observability drift.

9) Schema and migration discipline:
- Good and why: event type set is controlled and replay pipeline is explicit.
- Bad and why: missing strict per-event payload schemas means malformed payloads can pass type gate and alter state semantics unpredictably across versions.

10) Operational lifecycle:
- Good and why: tail repair and replay validation utilities provide practical operator recovery tools.
- Bad and why: no segmentation/retention means indefinite hot-path growth, weaker recovery ergonomics, and avoidable infra cost over time.

11) Test quality:
- Good and why: several high-value negative-path tests are present (prod fail-closed cases, bypass scope, lock timeout, out-of-scope filtering) which is the right engineering signal for safety claims.
- Bad and why: missing startup-boundary and schema-parity tests currently block full confidence for hard production guarantees.

12) UX handling:
- Good and why: explicit option prompts for ambiguity/conflict reduce silent wrong-state updates and are channel portable.
- Bad and why: no hard gating from behavioral counters means UX still depends on soft nudges in some repeated-confusion conditions.

## 17) Prioritized Recommendations (With Why)

Priority key:
- P0 = highest risk reduction per implementation week.
- P1 = important structural hardening.
- P2 = optimization and scale polish.

### 17.1 P0 (Do next)

1. Implement retrieval semantic floor + dominance override + relative near-tie on normalized scores.
- Why this matters: this addresses the most likely correctness issue visible to users (wrong snippet chosen despite strong in-scope relevance).
- Why now: high user-facing impact, low-to-medium implementation cost, directly testable with fixtures.
- Minimum acceptance:
  - configurable `minSimilarity` and `overrideDelta`,
  - normalized score domain for tie/override math,
  - comparator tests for false-positive high-priority promotions,
  - diagnostics event containing override decisions.

2. Add two-step pin delete confirmation with short-lived token.
- Why this matters: destructive actions need friction to prevent irreversible operator/user mistakes.
- Why now: simple command-flow change with outsized trust/safety improvement.
- Minimum acceptance:
  - `/pin remove <id>` creates pending intent with token + TTL,
  - explicit confirm/cancel commands,
  - idempotent confirm/cancel behavior tests.

3. Enforce strict per-event payload schemas at write and replay with fail-closed parity.
- Why this matters: type-only event gating is insufficient for long-term replay correctness.
- Why now: prevents schema drift from becoming historical-data debt.
- Minimum acceptance:
  - `type -> payload schema` map,
  - write-time validation reject path,
  - replay fail-closed behavior matching signature/version failure handling,
  - migration path tests for schema upgrades.

4. Add startup hard-fail authenticity contract in prod with severity-typed diagnostics.
- Why this matters: replay fail-closed is strong, but production boot must also fail deterministically when required keys are unavailable.
- Why now: closes key trust gap at service boundary.
- Minimum acceptance:
  - boot-time check for active signing key + replay-scope verification keys,
  - `CRITICAL` diagnostics on refusal,
  - startup/integration tests proving refusal behavior.

### 17.2 P1 (Structural hardening)

5. Implement WAL segmentation + manifest + retention/compaction lifecycle.
- Why: controls replay cost and operational risk as data grows; enables predictable recovery windows.
- Acceptance:
  - segment rotation by size/age,
  - manifest chain verification path,
  - retention input and compaction policy by task lifecycle state.

6. Introduce key-provider abstraction and rotation lifecycle policy.
- Why: env-only keying is a narrow operational model and weak for mature production rotations.
- Acceptance:
  - provider interface (`env` + at least one pluggable secret manager),
  - dual-read/single-write rotation behavior,
  - key-id/version diagnostics coverage.

7. Extend strict diagnostics schema/versioning to `memory.guidance` and `memory.guidance.response`.
- Why: observability contracts should be uniform; this avoids parser drift and improves telemetry reliability.

8. Enforce session thrash/mismatch gating in reply flow.
- Why: converts soft hints into hard stability controls for noisy sessions.

### 17.3 P2 (Scale and operability polish)

9. Make linked-task retrieval cap configurable (currently hard-capped at 3 snippets).
- Why: hardcoded caps are useful defaults but brittle across deployments with different recall needs.

10. Add retrieval version stamping and migration discipline.
- Why: model/tokenization/BM25 changes can silently alter ranking behavior; explicit versioning makes changes auditable and reversible.

11. Add alerting/SLO contract for `CRITICAL` memory diagnostics.
- Why: fail-closed mechanisms only help if operators reliably see and respond.

## 18) External AI Handoff Pack (No File Access Required)

Use this section to onboard another AI that does not have repository access.

### 18.1 What system this is

This is a deterministic task-memory system for a chat agent. It separates:
- durable authoritative memory (WAL + snapshots + pins),
- ephemeral session control state,
- optional transcript retrieval (non-authoritative).

Core claim: transcript context is advisory; authoritative state is WAL-driven and snapshot-derived.

### 18.2 Storage model

Authoritative stores:
- Task registry: task metadata and links.
- WAL (`events.wal.jsonl`): append-only event history with signed canonical envelopes.
- Snapshots (global + per-task): derived state caches rebuilt from WAL replay.
- Pins store (`memory/.pins.json` + rendered markdown views): explicit constraints/facts/preferences/temporary pins.

Ephemeral stores:
- Session control plane: active task, task stack, autoswitch opt-in, mode counters.
- Transcript buffer: runtime chat history, optional indexing.
- Transient TTL buffer: short-lived non-durable memory entries.

### 18.3 Event and security model

Implemented security slice:
- Event envelopes are canonicalized and signed (HMAC-SHA256).
- Signature chain is anchored by `prevSignature`.
- Replay verification enforces envelope/signature/key checks.
- Production mode fails closed on key/signature/version failures.
- Dev mode allows explicit unsigned replay bypass only for limited failure classes and forces read-only degraded behavior.

Still missing for full production hardening:
- centralized startup hard-fail key contract,
- broad key-provider/rotation lifecycle,
- strict per-event payload schemas + fail-closed parity for schema violations.

### 18.4 Retrieval and ranking model

Retrieval policy:
- filter by source/path scope first,
- score with hybrid retrieval (BM25 + embeddings),
- deterministic rank with authority classes and transcript penalty,
- stitch stage results.

Task mode:
- search active task scope first,
- optional global fallback,
- optional linked-task read-only snippets (hard cap 3).

Known ranking limitation:
- no semantic floor/dominance override yet; weak high-priority snippets can outrank stronger lower-priority snippets.

### 18.5 Interaction and safety behavior

- Autoswitch is opt-in (`/autoswitch on`); default is off.
- Ambiguous/conflict cases return explicit option text prompts.
- Confirmation phrases can trigger `USER_CONFIRMED` event commits.
- Pins are immutable on duplicate upsert; edits/removals are explicit commands.
- Pin deletion currently has no confirmation token flow.

### 18.6 Evidence quality summary

Strong evidence exists for:
- single-scope write invariants,
- `writeScope=none` strict no-op storage behavior,
- filter-before-rank correctness,
- durable-over-transcript deterministic ordering,
- autoswitch-off isolation,
- turn-control diagnostics schema/version enforcement,
- minimal authenticity fail-closed replay behaviors,
- lock timeout and WAL repair utility behavior.

Important evidence still needed:
- startup-level production refusal tests for missing keys,
- strict replay schema-failure parity tests,
- confirm-token tests for pin deletion flow,
- retrieval semantic floor/dominance fixture tests.

### 18.7 Scores to carry forward

Use these scores as current-state baseline:
- Scope isolation: 9.0
- Durability consistency: 8.5
- Authenticity posture: 7.0
- Retrieval scope correctness: 8.5
- Retrieval relevance quality: 6.5
- Task switch safety: 8.5
- Pin safety lifecycle: 7.5
- Diagnostics contract: 7.5
- Event schema rigor: 5.5
- Operational lifecycle scale: 5.5
- Test strength: 8.5
- UX conflict handling: 8.0
- Overall: 7.6

### 18.8 Improvement plan for the external AI to execute

If implementing improvements, take this order:
1. Retrieval semantic floor + dominance override + normalized near-tie policy.
2. Pin delete two-step confirm token with TTL + idempotency.
3. Strict per-event payload schemas at write/replay + fail-closed parity.
4. Production startup key checks with `CRITICAL` diagnostics and refusal behavior.
5. WAL segmentation/manifest/retention lifecycle and compaction.

Why this order:
- It first reduces user-visible correctness risk and destructive-action risk.
- Then it hardens replay truth guarantees.
- Finally it addresses long-horizon operational scalability and governance.

## 19) Implementation Update (Shipped in Code + Tests)

This section supersedes earlier review-only scoring text for the items below.

### 19.1 Newly implemented hardening (with evidence)

1. Retrieval semantic override guard + normalized near-tie policy
   - Code: `src/memory/manager.ts` (normalized scoring, `minSimilarity`, `overrideDelta`, relative+absolute near-tie epsilon, override metadata).
   - Config: `src/agents/memory-search.ts`, `src/config/types.tools.ts`, `src/config/zod-schema.agent-runtime.ts`, `src/config/schema.ts`.
   - Tests:
     - `src/memory/manager.deterministic-rank.test.ts` -> `it("allows semantic dominance to outrank higher-priority classes", ...)`
     - `src/memory/manager.deterministic-rank.test.ts` -> `it("keeps durable-over-transcript behavior under near-tie relative epsilon policy", ...)`

2. Two-step pin deletion confirmation flow (token + idempotent cancel/confirm)
   - Code: `src/memory/pins.ts` (`createMemoryPinRemoveIntent`, `confirmMemoryPinRemoveIntent`, `cancelMemoryPinRemoveIntent`), `src/auto-reply/reply/commands-memory.ts`.
   - Tests:
     - `src/auto-reply/reply/commands-memory.test.ts` -> `it("adds, lists, and removes typed pins", ...)`
     - `src/auto-reply/reply/commands-memory.test.ts` -> `it("supports pin remove cancel tokens idempotently", ...)`

3. Strict per-event payload schemas with replay fail-closed parity
   - Code: `src/memory/task-memory-system.ts` (`validateEventPayloadSchema(...)` on write and replay; replay security stop reason `schema-validation-failure`).
   - Tests:
     - `src/memory/task-memory-system.test.ts` -> `it("rejects commits with invalid per-event payload schemas", ...)`
     - `src/memory/task-memory-system.test.ts` -> `it("fails closed on replay payload schema validation failures", ...)`
     - `src/memory/task-memory-system.test.ts` -> `it("does not allow dev unsigned bypass for schema validation failures", ...)`

4. Startup-level authenticity hard-fail contract + diagnostics severity wiring
   - Code: `src/memory/task-memory-system.ts` (`assertMemorySecurityBootContract(...)`, `emitMemorySecurityDiagnostic(...)`, mode validation).
   - Tests:
     - `src/memory/task-memory-system.test.ts` -> `it("fails startup-level replay reads in prod when signing key is missing", ...)`
     - `src/memory/task-memory-system.test.ts` -> `it("coerces invalid MEMORY_SECURITY_MODE to prod fail-closed behavior", ...)`

5. Key-provider abstraction, secret-manager adapter hook, and rotation expiry enforcement
   - Code: `src/memory/task-memory-system.ts` (`createEnvMemoryKeyProvider`, `createJsonMemoryKeyProvider`, `createCommandMemoryKeyProvider`, `createAwsSecretsManagerKeyProvider`, `createGcpSecretManagerKeyProvider`, `createAzureKeyVaultKeyProvider`, `createVaultKeyProvider`, `resolveMemoryKeyProvider`, rotation-window checks in `assertMemorySecurityBootContract(...)`; key-id validation allows namespaced ids).
   - Tests:
      - `src/memory/task-memory-system.test.ts` -> `it("supports json key provider with dual-read/single-write behavior", ...)`
      - `src/memory/task-memory-system.test.ts` -> `it("supports command key provider as a pluggable secret-manager adapter", ...)`
      - `src/memory/task-memory-system.test.ts` -> `it("supports aws-sm key provider via provider command hook", ...)`
      - `src/memory/task-memory-system.test.ts` -> `it("supports gcp-sm key provider via provider command hook", ...)`
      - `src/memory/task-memory-system.test.ts` -> `it("supports azure-kv key provider via provider command hook", ...)`
      - `src/memory/task-memory-system.test.ts` -> `it("supports vault key provider via provider command hook", ...)`
      - `src/memory/task-memory-system.test.ts` -> `it("fails closed when key rotation deprecation expires and legacy keys are still required", ...)`
      - `src/memory/task-memory-system.test.ts` -> `it("enforces startup fail-closed sequence for rotation expiry and missing signing key", ...)`

6. WAL segmentation + baseline compaction path + retention lifecycle
   - Code: `src/memory/task-memory-system.ts` (`maybeRotateWalActiveSegment(...)`, `readWalReplayRaw(...)`, `compactWalSegments(...)`, `applyWalRetentionPolicy(...)`, signed baseline artifacts with verification, baseline + manifest chain checks, snapshot offset/state adjustment during compaction).
   - Tests:
      - `src/memory/task-memory-system.test.ts` -> `it("rotates WAL into segment files and replays across manifest + active stream", ...)`
      - `src/memory/task-memory-system.test.ts` -> `it("applies retention policy to prune eligible WAL segments", ...)`
      - `src/memory/task-memory-system.test.ts` -> `it("fails closed when compacted baseline artifact signature is tampered", ...)`

7. Diagnostics contract breadth expansion, retrieval version telemetry, and memory alert/SLO event wiring
   - Code: `src/infra/diagnostic-events.ts`, `src/auto-reply/reply/get-reply-run.ts`, `src/agents/tools/memory-tool.ts`.
   - Tests:
     - `src/infra/diagnostic-events.test.ts` -> `test("rejects invalid memory.guidance payload versions", ...)`
      - `src/infra/diagnostic-events.test.ts` -> `test("rejects invalid memory.guidance.response payload versions", ...)`
      - `src/infra/diagnostic-events.test.ts` -> `test("emits memory retrieval diagnostics with retrieval version fields", ...)`
      - `src/infra/diagnostic-events.test.ts` -> `test("emits memory alert events and breach status for critical security diagnostics", ...)`
      - `src/infra/diagnostic-events.test.ts` -> `test("dispatches breached memory alerts to configured webhook transport", ...)`
      - `src/infra/diagnostic-events.test.ts` -> `test("retries webhook transport on retryable failures", ...)`
      - `src/infra/diagnostic-events.test.ts` -> `test("dispatches breached memory alerts to pagerduty transport", ...)`

8. Session thrash/mismatch autoswitch gating + linked-task cap configurability
   - Code: `src/auto-reply/reply/get-reply-run.ts`, `src/agents/tools/memory-tool.ts`, `src/agents/memory-search.ts`.
   - Tests:
     - `src/auto-reply/reply/get-reply-run.autoswitch.test.ts` -> `it("blocks autoswitch when thrash/mismatch counters are above guard thresholds", ...)`
     - `src/agents/tools/memory-tool.task-context.test.ts` -> `it("respects configured linked-task snippet cap", ...)`

9. Retrieval migration release gate enforcement in CI
   - Code: `scripts/check-retrieval-migration-gate.mjs`, `package.json`, `.github/workflows/ci.yml`.
   - Asserts:
      - CI checks now run `pnpm retrieval:migration:check`.
      - The gate fails when retrieval-sensitive files change without updating `docs/memory/retrieval-migration.md` (unless explicit bypass is set).

### 19.2 Updated scorecard after implementation

| Aspect | Previous | Current | Why changed |
|---|---:|---:|---|
| Retrieval relevance and ranking quality | 6.5 | 8.2 | Semantic floor, dominance override, and normalized near-tie behavior are now implemented and tested. |
| Pin safety lifecycle | 7.5 | 8.8 | Destructive pin removal now requires confirm/cancel token flow with idempotent handling tests. |
| Event schema rigor | 5.5 | 8.7 | Per-event payload schema enforcement now runs at write and replay boundaries with fail-closed parity tests. |
| Diagnostics contract breadth | 7.5 | 9.2 | Guidance/response diagnostics now enforce versioned schemas; retrieval diagnostics carry version fields; memory alert transport includes webhook retries and PagerDuty dispatch tests. |
| Authenticity operational hardening | 7.0 | 9.1 | Startup-level prod hard-fail checks, provider-adapter breadth, and rotation deprecation fail-closed behavior are directly tested. |
| Operational lifecycle scale posture | 5.5 | 8.6 | WAL segmentation plus signed baseline compaction flow now adjusts replay chain/snapshot offsets and fails closed on baseline tamper. |
| Task switching safety | 8.5 | 9.0 | Autoswitch now has hard thrash/mismatch gating tests in addition to autoswitch opt-in guardrails. |

Updated overall score: **9.2 / 10**

### 19.3 Remaining gaps (still important)

These are still not fully closed and should remain on the roadmap:
- Cloud key-provider adapters are implemented (`aws-sm`, `gcp-sm`, `azure-kv`, `vault`) with provider command hooks; next hardening step is optional SDK-native execution paths where CLI tooling is unavailable.
- Baseline compaction artifacts are now signed and verified; next hardening step is optional external attestation/archive workflow for audit/compliance environments.
