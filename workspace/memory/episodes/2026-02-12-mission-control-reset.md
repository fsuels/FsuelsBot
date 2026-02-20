# Episode: Mission Control Reset and Cron Cleanup

> Date range: 2026-02-12
> Confidence: high

## Summary

- User wanted a full reset: zero tasks and zero cron jobs in all columns.
- Initial attempts were blocked by stale paths/cache and split cron storage.

## Durable Outcomes

- Path mismatch identified (`workspace/` vs `clawd/`) and corrected.
- Cron source moved/cleared and delete endpoint fixed against the right file.
- Cron count/zero display normalized in UI.
- source: session logs 2026-02-12
