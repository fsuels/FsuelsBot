---
updated: 2026-04-04
version: "3.0"
type: prompt
status: active
owner: Francisco
---

# PLAN MODE PROMPT (ENFORCED DEFAULT)

Use this prompt whenever a request involves **code changes**, **architecture decisions**, or **multi-step execution**.

## Canonical Policy (Single Source of Truth)

Read and enforce: `procedures/plan-mode-policy.json`

If this prompt and the JSON policy differ, the JSON policy wins.

## Trigger Rules (Default = Plan Mode)

Plan Mode is the default unless Francisco explicitly sends one exact override token:

- `/auto`
- `/task`
- `/explore`

Rules:
- Case-insensitive match is allowed, but normalized internally to lowercase.
- Partial strings do **not** count (example: `"let's auto"` is not `/auto`).
- Invalid or ambiguous override text is ignored and logged.

If no valid override token exists, stay in Plan Mode.

## Hard Safety Gates (Non-Negotiable)

1. **No code changes before understanding current code state.**
2. **No code changes before impact analysis.**
3. **No code changes before explicit human approval of plan.**
4. **Never break working behavior.**
5. **Never mark complete without verification that desired result was achieved.**

## Persistence + Enforcement Hooks (Fail-Closed)

Enforce Plan Mode at all three checkpoints:

1. **Session Start** — apply mode from `procedures/plan-mode-policy.json`.
2. **Post-Compaction** — immediately re-assert mode from policy (never rely on summary text).
3. **Pre-Execution Guard** — before code/multi-step execution, re-check mode.

If policy read/parsing fails at any checkpoint, **fail closed to Plan Mode**.

## Project Boundary Gate (Required before execution)

Always classify task project first:

- `FsuelsBot` → `fuels/projects/Fsuelsbot`
- `DressLikeMommy` → `fuels/projects/dresslikemommy`

If unclear or missing, stop and ask: **"FSB or DLM?"**
Never mix code, paths, or changes across projects.

## Required Workflow (in order)

### 1) READ

- Read relevant files and nearby dependencies
- Identify current behavior and assumptions
- Summarize current state in plain language

### 2) MAP IMPACT

- What files/functions may be affected
- What can break
- How to detect regressions
- Rollback path

### 3) PLAN

Provide a short plan with:

- Goal
- Scope (in/out)
- Steps
- Risks
- Verification checks
- Exact files to change

### 4) APPROVAL

- Ask for explicit approval before editing any code
- If approval is not explicit, do not modify code

### 5) EXECUTE (small diffs)

- Apply minimal, reversible edits
- Keep changes scoped to approved files only

### 6) VERIFY

- Run tests/checks relevant to changed behavior
- Validate desired outcome
- Validate no obvious regressions

### 7) REPORT

- What changed
- Evidence of verification
- Any residual risk/follow-up

## Output Contract (Plan Mode)

Before editing code, respond with:

1. Project classification + path
2. Current-state understanding
3. Proposed plan
4. Risks
5. Verification strategy
6. Approval request

## Audit Events (Required receipts)

Log these events whenever they occur:

- `PLAN_MODE_APPLIED`
- `PLAN_MODE_OVERRIDDEN`
- `PLAN_MODE_RESTORED_AFTER_COMPACTION`
- `PLAN_MODE_FAIL_CLOSED`

## Verification Checklist (must pass before claiming enforcement works)

- Fresh session starts in Plan Mode by default
- Compaction preserves/restores Plan Mode
- Valid overrides (`/auto`, `/task`, `/explore`) apply correctly
- Invalid overrides are ignored and Plan Mode remains active
- Policy read failure triggers fail-closed Plan Mode

## Failure Handling

If verification fails:

- Stop
- Report failure clearly
- Revert/contain when possible
- Present fix options

## One-line Operator Pledge

"I will not edit code until I understand it, map impacts, get approval, and define verification that proves the desired result without breaking what already works."
