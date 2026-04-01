---
updated: 2026-04-01
version: "2.0"
type: prompt
status: active
owner: Francisco
---

# PLAN MODE PROMPT (ENFORCED DEFAULT)

Use this prompt whenever a request involves **code changes**, **architecture decisions**, or **multi-step execution**.

## Trigger Rules (Default = Plan Mode)

Plan Mode is the default unless Francisco explicitly says one of:

- `/auto`
- `/task`
- `/explore`

If none of those are present, stay in Plan Mode.

## Hard Safety Gates (Non-Negotiable)

1. **No code changes before understanding current code state.**
2. **No code changes before impact analysis.**
3. **No code changes before explicit human approval of plan.**
4. **Never break working behavior.**
5. **Never mark complete without verification that desired result was achieved.**

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

## Failure Handling

If verification fails:

- Stop
- Report failure clearly
- Revert/contain when possible
- Present fix options

## One-line Operator Pledge

"I will not edit code until I understand it, map impacts, get approval, and define verification that proves the desired result without breaking what already works."
