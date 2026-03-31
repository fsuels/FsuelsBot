# Task: It needs to run locally to be able to see

- **Task ID:** `it-needs-to-run-locally-to-be-able-to-see`
- **Status:** done
- **Lane:** done_today

## Summary

Run the required local service/interface so it is visible directly on this machine.

## Goal

Start the needed local runtime and provide a concrete local access receipt (URL/process/status) proving it is running.

## Execution Receipts

1. Killed stale local Mission Control process `PID 35701` and restarted with local bind:
   - `DASHBOARD_BIND=127.0.0.1`
   - `MISSION_CONTROL_PORT=8765`
   - New process `PID 74962`
2. HTTP health receipt:
   - `curl -I http://127.0.0.1:8765` → `HTTP/1.0 200 OK`
3. Content receipt:
   - `GET http://127.0.0.1:8765/` returned HTML (`<!doctype html> ...`)

## Result

Mission Control is running locally and is now visible at:

- **http://127.0.0.1:8765**

## Handoff

- **What is done:** Local runtime is up and serving content.
- **Next action:** Keep server running and use the local URL above.
- **Blockers:** none
