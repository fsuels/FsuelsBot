# Subagent Task Specs

Use structured worker handoffs for `implementation`, `correction`, and `verification` work.

The goal is simple: every worker prompt should stand on its own. A worker should not need hidden chat context to understand what to do, what facts matter, or how to know it is done.

## Rules

- Include a short purpose statement.
- Restate the concrete facts the worker needs inline.
- Add explicit done criteria.
- Keep `research` and `verification` workers read-only.
- Use a fresh worker for verification instead of asking the implementation worker to verify its own changes.

## Bad vs Good

Bad:

```text
Based on your findings, fix the bug we found in auth.
```

Good:

```text
taskType: implementation
task: Fix the auth retry bug
facts:
- src/auth/retry.ts retries forever after ECONNRESET on the first request.
- The retry loop should stop after the second network failure.
doneCriteria:
- Patch the retry guard in src/auth/retry.ts.
- Add or update regression coverage for the double-failure case.
```

Bad:

```text
As discussed, please verify the recent changes.
```

Good:

```text
taskType: verification
task: Verify the auth retry fix
facts:
- src/auth/retry.ts was patched to stop retrying after the second failure.
- Regression coverage should focus on the login retry path.
doneCriteria:
- Run the auth retry regression test suite.
- Exercise one edge or error path and report the evidence.
```

Bad:

```text
Continue from the earlier thread and clean things up.
```

Good:

```text
taskType: correction
task: Correct the retry guard follow-up
facts:
- The previous attempt fixed the loop but broke the offline fallback path.
- Only src/auth/retry.ts and src/auth/retry.test.ts are in scope.
doneCriteria:
- Restore the offline fallback behavior.
- Keep the retry regression passing.
```
