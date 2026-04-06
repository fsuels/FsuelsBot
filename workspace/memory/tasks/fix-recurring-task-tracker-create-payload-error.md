# Task Memory — fix-recurring-task-tracker-create-payload-error

## Goal
Eliminate recurring scheduled Task Tracker failure: `status is not supported for action=create`.

## Current State
Resolved on 2026-04-04. Runtime now accepts `task_tracker` `action=create` payloads that include `status` by sanitizing the field, and live smoke validation succeeded after gateway restart.

## Decisions
- 2026-04-04: Added explicit rule in system prompt generation: for `task_tracker` with `action=create`, do not send `status`; set status only via `action=update`.
- 2026-04-04: Kept scope limited to fixing the create-payload rule first before broader cron flow refactors.
- 2026-04-04: Implemented defensive hotfix in `task_tracker` tool validation to strip `status` for `action=create` instead of failing.
- 2026-04-04: Added regression test to lock behavior for `create` payloads that include `status`.
- 2026-04-04: Verified in isolated verifier session plus live runtime smoke test after gateway restart.

## Validated Facts
- Recurring scheduler error text observed before fix: `Task Tracker: create · create failed` + `status is not supported for action=create`.
- Prompt-layer guidance change was committed earlier as `05b7d06a69`.
- Tool-layer hotfix and regression test were committed as `e2478e2036`.
- Targeted test result on 2026-04-04: `pnpm -s vitest src/agents/openclaw-tools.action-validation.test.ts` → 13 passed, 0 failed.
- Live post-restart smoke test on 2026-04-04: `task_tracker action=create` with `status` succeeded (no invalid_input error).

## Open Questions
- RESOLVED: What exact path still emitted invalid create payloads after prompt-only fix?
  - Answer: runtime calls could still include `status`; tool-layer validation boundary needed to sanitize for reliability.

## Next Actions
1. Monitor scheduled reminder runs for recurrence of the same error signature.
2. If recurrence appears, capture exact transcript/session and identify any non-standard producer path.

## Key Entities
- task_id: `fix-recurring-task-tracker-create-payload-error`
- commit_prompt_layer: `05b7d06a69`
- commit_tool_layer: `e2478e2036`
- file_changed: `/Users/fsuels/Projects/FsuelsBot/src/agents/system-prompt.ts`
- file_changed: `/Users/fsuels/Projects/FsuelsBot/src/agents/tools/task-tracker-tool.ts`
- file_changed: `/Users/fsuels/Projects/FsuelsBot/src/agents/openclaw-tools.action-validation.test.ts`
- recurring_error: `status is not supported for action=create`
