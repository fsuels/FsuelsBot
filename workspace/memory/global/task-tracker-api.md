# Task Tracker API Durable Notes

## Pins
- [constraint] `task_tracker` does not accept `status` for `action=create`; default initial status is `pending`.

## Validated Facts
- Runtime/tool error message confirmed historical constraint: `status is not supported for action=create`.
- Correct pattern remains: create first without status, then transition via `action=update` (e.g., `in_progress`, `completed`, `blocked`).
- 2026-04-04: Defensive runtime hotfix added in tool validation: when `action=create`, incoming `status` is sanitized (dropped) instead of raising invalid_input.
- 2026-04-04: Regression test added to preserve this sanitization behavior.

## Open Questions
- Should the pinned constraint be explicitly unpinned/reworded to reflect sanitization-tolerant runtime behavior while preserving the API intent?

## Last Reviewed
2026-04-04
